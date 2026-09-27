import { initBotId } from 'botid/client/core';

initBotId({
  protect: [
    {
      path: '/api/session',
      method: 'GET',
      advancedOptions: {
        checkLevel: 'basic'
      }
    }
  ]
});
