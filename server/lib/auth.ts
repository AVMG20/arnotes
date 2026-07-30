import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins/organization'
import { db } from '../db'
import * as schema from '../db/schema'

const discordEnabled = process.env.NUXT_PUBLIC_DISCORD_ENABLED === 'true'
  && Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)
const githubEnabled = process.env.NUXT_PUBLIC_GITHUB_ENABLED === 'true'
  && Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation
    }
  }),
  plugins: [
    organization({
      // Better Auth only returns columns it knows about, so `joinCode` has to be
      // declared here or it is stripped from every organization response.
      // `input: false` keeps it server-issued — clients can never set their own.
      schema: {
        organization: {
          additionalFields: {
            joinCode: { type: 'string', required: false, input: false }
          }
        }
      }
    })
  ],
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.ALLOW_SIGN_UP === 'false'
  },
  socialProviders: {
    ...(discordEnabled
      ? {
          discord: {
            clientId: process.env.DISCORD_CLIENT_ID!,
            clientSecret: process.env.DISCORD_CLIENT_SECRET!
          }
        }
      : {}),
    ...(githubEnabled
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!
          }
        }
      : {})
  },
  trustedOrigins: [process.env.BETTER_AUTH_URL || 'http://localhost:3000']
})
