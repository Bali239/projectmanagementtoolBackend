import { allowedOrigins } from "./origins.js";

export function getSocketOptions({ hasRedisAdapter }) {
	return {
		...(!hasRedisAdapter && {
			connectionStateRecovery: {
				maxDisconnectionDuration: 2 * 60 * 1000,
				skipMiddlewares: false,
			},
		}),
		cors: {
			origin(origin, callback) {
				if (!origin || allowedOrigins.has(origin)) return callback(null, true);
				return callback(new Error("Request origin is not allowed"));
			},
			credentials: true,
		},
	};
}
