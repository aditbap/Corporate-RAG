import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '../../.env' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function check() {
  const { data: doc } = await supabase.from('documents').select('file_name').eq('id', '58706185-08dd-4d79-929d-75c9a9119eab').single();
  console.log('FileName:', doc.file_name);
}
check();
