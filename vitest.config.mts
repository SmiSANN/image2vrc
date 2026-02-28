import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				main: './functions/[[route]].ts',
				miniflare: {
					compatibilityDate: '2024-10-11',
					compatibilityFlags: ['nodejs_compat'],
					r2Buckets: ['MY_BUCKET'],
				},
			},
		},
	},
});
