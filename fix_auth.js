const fs = require('fs');
let code = fs.readFileSync('server/supabaseAuthState.ts', 'utf8');

code = code.replace(/await Promise\.all\(tasks\);/g, `
          // Run tasks sequentially to avoid overwhelming Supabase
          for (const task of tasks) {
            await task();
          }
`);

// Also we need to change how tasks are built. Instead of pushing Promises, we push functions returning Promises.
