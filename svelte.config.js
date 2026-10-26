import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// Static build so the site can be hosted on GitHub Pages or any static host.
		adapter: adapter({ fallback: undefined }),
		paths: { base: process.env.BASE_PATH ?? '' }
	}
};

export default config;
