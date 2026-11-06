// alsuhaiby.com on Cloudflare Workers (static assets from dist/). The only code: http:// and www. → https://alsuhaiby.com (301).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.alsuhaiby.com' || url.protocol === 'http:') {
      url.hostname = 'alsuhaiby.com';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
