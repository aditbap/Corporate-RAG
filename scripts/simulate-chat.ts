import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import jwt from 'jsonwebtoken';

async function main() {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("No secret");

  // Spoof a Supabase JWT
  const payload = {
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + (60 * 60),
    sub: '00000000-0000-0000-0000-000000000001',
    email: 'test@example.com',
    role: 'authenticated'
  };
  
  const token = jwt.sign(payload, secret);
  
  console.log("Starting chat simulation...");
  const chatRes = await fetch('http://localhost:3001/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'What is RAG?' }],
      stream: true
    })
  });
  
  if (!chatRes.ok) {
    const text = await chatRes.text();
    console.error("Chat failed:", chatRes.status, text);
    process.exit(1);
  }

  let conversationId = null;
  const reader = chatRes.body;
  if (!reader) throw new Error("No body");
  
  // Read stream using node-fetch
  for await (const chunk of reader) {
    const str = chunk.toString();
    console.log("Chunk:", str.trim());
    if (str.includes('"type":"meta"')) {
      const match = str.match(/"conversationId":"([^"]+)"/);
      if (match) conversationId = match[1];
    }
  }

  console.log("Chat completed. Conversation ID:", conversationId);
  
  // Wait a bit for title generation
  await new Promise(r => setTimeout(r, 2000));
  
  console.log("Fetching conversations...");
  const convRes = await fetch('http://localhost:3001/api/v1/conversations', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!convRes.ok) {
    console.error("Conv failed:", await convRes.text());
    process.exit(1);
  }
  const convData = await convRes.json();
  console.log("Conversations list:", convData);
  
  if (conversationId) {
    console.log(`Fetching messages for ${conversationId}...`);
    const msgRes = await fetch(`http://localhost:3001/api/v1/conversations/${conversationId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const msgData = await msgRes.json();
    console.log(`Messages (${msgData.messages?.length || 0}):`, msgData.messages);
  }
  
  console.log("Simulation complete!");
}

main().catch(console.error);
