import net from 'net';

export interface ScanResult {
  infected: boolean;
  signature?: string;
}

/**
 * Scans a buffer via clamd's INSTREAM protocol directly over TCP — no npm
 * client library, since the protocol is a handful of lines (a size-prefixed
 * stream of chunks terminated by a zero-length chunk) and pulling in a
 * dependency for it isn't worth it.
 * https://docs.clamav.net/manual/Usage/Scanning.html#stream-scan
 */
export async function scanBuffer(buffer: Buffer, host?: string, port?: number): Promise<ScanResult> {
  const clamavHost = host || process.env.CLAMAV_HOST || 'localhost';
  const clamavPort = port || parseInt(process.env.CLAMAV_PORT || '3310', 10);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: clamavHost, port: clamavPort });
    let response = '';

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');

      const CHUNK_SIZE = 1024 * 1024; // 1MB
      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
        const sizeHeader = Buffer.alloc(4);
        sizeHeader.writeUInt32BE(chunk.length, 0);
        socket.write(Buffer.concat([sizeHeader, chunk]));
      }
      // Zero-length chunk terminates the stream
      const terminator = Buffer.alloc(4);
      terminator.writeUInt32BE(0, 0);
      socket.write(terminator);
    });

    socket.on('data', (data) => {
      response += data.toString('utf-8');
    });

    socket.on('error', (err) => reject(err));

    socket.on('close', () => {
      // Response looks like "stream: OK\0" or "stream: Eicar-Test-Signature FOUND\0"
      const clean = response.replace(/\0/g, '').trim();
      if (clean.endsWith('OK')) {
        resolve({ infected: false });
      } else if (clean.includes('FOUND')) {
        const signature = clean.replace('stream:', '').replace('FOUND', '').trim();
        resolve({ infected: true, signature });
      } else {
        reject(new Error(`Unexpected clamd response: ${clean}`));
      }
    });
  });
}
