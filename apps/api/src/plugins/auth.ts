import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import jwt from 'jsonwebtoken'

export interface AuthUser {
  sub: string   // user ID
  orgId: string
  role: string
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    user: AuthUser
    rawBody?: string  // preserved by the content-type parser in index.ts for HMAC routes
  }
}

export default fp(function authPlugin(
  fastify: FastifyInstance,
  _opts: object,
  done: () => void,
) {
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const header = request.headers.authorization
      if (!header?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing or invalid authorization header' })
      }
      try {
        const payload = jwt.verify(
          header.slice(7),
          process.env.JWT_SECRET!,
        ) as AuthUser
        request.user = payload
      } catch {
        return reply.status(401).send({ error: 'Invalid or expired token' })
      }
    },
  )
  done()
})
