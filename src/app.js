const express = require('express')
const compression = require('compression')
const serveStatic = require('serve-static')
const path = require('path')
const http = require('http')
const debug = require('debug')('WikiBattle:app')
const newless = require('newless')
const schedule = require('node-schedule').scheduleJob
const tmp = require('tmp')

const wiki = require('./wiki')
const WikiUpdater = require('./WikiUpdater')
const WikiPages = require('./WikiPages')
const MatchMaker = require('./MatchMaker')
const SocketHandler = require('./SocketHandler')

const CSS_FILE = path.join(__dirname, '../public/wiki.css')
const PAGES_FILE = tmp.fileSync({
  discardDescriptor: true
}).name

const app = express()
const server = http.createServer(app)
const WebSocketServer = newless(require('ws').Server)
const ws = WebSocketServer({ server })

app.use(compression())

const updater = WikiUpdater({
  cssPath: CSS_FILE,
  pagesPath: PAGES_FILE
})
const wikiPages = WikiPages(PAGES_FILE)
const matchMaker = MatchMaker({
  pages: wikiPages
})

/**
 * Set up the WebSocket communications handler.
 */

const handler = SocketHandler(ws, matchMaker)
handler.start()

/**
 * Start the wikipedia article list updater.
 */

updater.update()
schedule('0 0 0 * * *', () => {
  updater.update().catch((err) => {
    if (err) {
      console.error('Update failed:')
      console.error(err.stack)
    }
  })
})

/**
 * Wait for pages list to be loaded before responding to requests.
 */

app.use(t(async (req, res, next) => {
  await wikiPages.ready()
  next()
}))

/**
 * Serve the application.
 */

app.use(serveStatic(path.join(__dirname, '../public')))

/**
 * Serve proxied Wikipedia articles.
 */

app.get('/wiki/:page', t(async (req, res) => {
  const body = await wiki.get(req.params.page)
  res.end(body.content)
}))

/**
 * Handle errors.
 */

app.use((req, res, next) => {
  const err = new Error('Not Found')
  err.status = 404
  next(err)
})

if (app.get('env') === 'development') {
  app.use((err, req, res, next) => {
    res.writeHead(err.status || 500, { 'content-type': 'text/html' })
    res.write(`<h1>${err.message}</h1>`)
    res.write(`<h2>${err.status}</h2>`)
    res.write(`<pre>${err.stack}</pre>`)
    res.end()
  })
} else {
  app.use((err, req, res, next) => {
    res.writeHead(err.status || 500, { 'content-type': 'text/html' })
    res.write(`<h1>${err.message}</h1>`)
    res.write(`<h2>${err.status}</h2>`)
    res.end()
  })
}

/**
 * Run the server.
 */

app.set('port', process.env.PORT || 3000)

server.listen(app.get('port'), () => {
  debug(`Express server listening on port ${server.address().port}`)
})

debug('Waiting for wiki pages')
wikiPages.ready().then(() => {
  debug('Ready')
})

function t (middleware) {
  return (req, res, next) => {
    middleware(req, res, next).catch(next)
  }
}
