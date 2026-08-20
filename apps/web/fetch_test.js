import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '../../.env' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: { user }, error: authError } = await supabase.auth.admin.createUser({
    email: 'test' + Date.now() + '@example.com',
    password: 'password123',
    email_confirm: true
  });
  
  if (authError) {
    console.error("Auth error:", authError);
    return;
  }
  
  const { data: session, error: loginError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: 'password123'
  });
  
  if (loginError) {
    console.error("Login error:", loginError);
    return;
  }
  
  const token = session.session.access_token;
  console.log("Token:", token.substring(0, 10) + "...");
  
  const id = '58706185-08dd-4d79-929d-75c9a9119eab';
  const res = await fetch(`http://localhost:3001/api/v1/documents/${id}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text.substring(0, 500));
}
check();
