import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, HtmlParser } from '@rag/providers';

test('htmlToText drops scripts, styles and comments but keeps visible text', () => {
  const out = htmlToText('<html><head><style>p{color:red}</style></head><body><!-- hidden --><h1>Info</h1><p>Nama kepala gudang adalah Budi &amp; Sari.</p><script>alert(1)</script></body></html>');
  assert.equal(out, 'Info\n\nNama kepala gudang adalah Budi & Sari.');
});

test('htmlToText decodes numeric entities and keeps unknown ones untouched', () => {
  assert.equal(htmlToText('<p>&#65;&#x42; &unknown; &#0;</p>'), 'AB &unknown; &#0;');
});

test('HtmlParser parses html and rejects other types', async () => {
  const parser = new HtmlParser();
  const parsed = await parser.parse(Buffer.from('<p>halo</p>'), 'html');
  assert.equal(parsed.text, 'halo');
  await assert.rejects(() => parser.parse(Buffer.from('x'), 'pdf'), /Unsupported file type/);
});
