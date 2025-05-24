// mock/api.js
import { exec } from 'child_process';

export default [
  {
    url: '/api/piper',
    method: 'get',
    response: (req) => {
      const txt = req.query.txt;

      return new Promise((resolve) => {
        exec(`ssh localhost piper/run.sh ${txt}`, (error, stdout, stderr) => {
          if (error) {
            console.log('error', error, stdout, stderr)
            resolve()
            return
          }
          resolve()
        });
      });
    },
  },
  {
    url: '/api/tts',
    method: 'get',
    response: 'ok'
  },
];
