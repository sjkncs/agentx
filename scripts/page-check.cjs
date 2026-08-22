const http = require('http');
http.get('http://127.0.0.1:3000/data-tasks', res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    const titleMatch = body.match(/<title>([^<]+)<\/title>/);
    console.log('Title:', titleMatch ? titleMatch[1] : 'not found');
    console.log('Body length:', body.length);
    ['DataFoundry', 'Data Tasks', 'Scheduled', 'resources', 'Tools', 'agents', 'Analytics', 'error', 'Error'].forEach(c => {
      const re = new RegExp(c, 'gi');
      const matches = body.match(re);
      if (matches) console.log('  found "' + c + '": ' + matches.length + ' times');
    });
  });
});
