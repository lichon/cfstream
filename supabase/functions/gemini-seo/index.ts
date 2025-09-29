console.info('server started');
Deno.serve(async (request) => {
  const url = new URL(request.url);
  const targetURL = new URL('https://generativelanguage.googleapis.com');
  targetURL.pathname = url.pathname.substring(12);
  targetURL.search = url.search;
  console.log(targetURL.pathname);
  const newRequest = new Request(targetURL, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });
  const response = await fetch(newRequest);
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers')
  };
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const responseHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    responseHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
});
