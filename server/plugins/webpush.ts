import { getWebPush } from '../utils/push'

// Nitro plugin: eagerly configure web-push at server startup so the first
// dispatch run doesn't pay the setVapidDetails cost mid-loop.
export default defineNitroPlugin(() => {
  getWebPush()
})
