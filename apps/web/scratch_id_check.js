import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '../../.env' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: version } = await supabase.from('document_versions').select('*').eq('document_id', '58706185-08dd-4d79-929d-75c9a9119eab').order('version_number', { ascending: false }).limit(1).single();
  
  if (!version) return console.log("No version");
  console.log("Version filePath:", version.file_path);
  
  let actualPath = version.file_path;
  if (actualPath.includes('tmp/uploads/')) {
    const relative = actualPath.substring(actualPath.indexOf('tmp/uploads/'));
    actualPath = path.join(process.cwd(), '../api', relative);
  }
  
  console.log("Actual path:", actualPath);
  try {
    await fs.promises.access(actualPath);
    console.log("File exists!");
  } catch (err) {
    console.error("Access error:", err.message);
  }
}
check();
