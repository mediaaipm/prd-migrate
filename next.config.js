/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.sanatansansaar.com' },
    ],
  },
}

module.exports = nextConfig
