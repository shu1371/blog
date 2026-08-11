import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 3000);
const server = createApp();
server.listen(port, () => console.log(`lxtoxyf site listening on :${port}`));
