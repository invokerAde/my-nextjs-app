import NextAuth from 'next-auth';

import { config } from './auth';
const { auth:proxy } = NextAuth(config);
export default proxy;

