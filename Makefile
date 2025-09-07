dev:
	docker compose -f infra/docker/docker-compose.yml up -d
	pnpm dev
