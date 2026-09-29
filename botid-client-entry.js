import { initBotId } from 'botid/client/core';

initBotId({
  protect: [
    {
      path: '/api/session',
      method: 'GET',
      advancedOptions: { checkLevel: 'basic' }
    },
    {
      path: '/api/staff-session',
      method: 'GET',
      advancedOptions: { checkLevel: 'basic' }
    },
    {
      path: '/api/staff-auth',
      method: 'POST',
      advancedOptions: { checkLevel: 'basic' }
    }
  ]
});
