// mock/api.js
import { exec } from 'child_process';

export default [
  {
    url: '/api/tts',
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
          exec('mpv --audio-device=wasapi\/{a8b47dd6-3226-48db-9b72-862860a13f42} /Users/lc/tmp/tmp.wav', (error, stdout, stderr) => {
            if (error) {
              console.log('error', error, stdout, stderr)
            }
            resolve()
          });
        });
      });
    },
  },
];
