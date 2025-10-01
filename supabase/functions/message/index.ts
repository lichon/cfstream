Deno.serve(async (req)=>{
  const szUrl = Deno.env.get('SZ_URL');
  if (req.method !== 'POST') {
    return new Response(`${szUrl}`);
  }
  const body = await req.json();
  return fetch(`${szUrl}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      'apikey': Deno.env.get('SZ_KEY'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      private: false,
      messages: [
        {
          topic: `room:${body.room}:messages`,
          event: "message",
          payload: {
            id: crypto.randomUUID(),
            content: body.content,
            sender: "supabase",
            timestamp: new Date().toISOString()
          }
        }
      ]
    })
  });
});
