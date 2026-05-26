# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ cmd/
COPY internal/ internal/

RUN CGO_ENABLED=0 GOOS=linux go build -o winston ./cmd/winston

# Runtime stage
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /build/winston .

# Data directories (mount volumes here)
RUN mkdir -p /data/agents /data/config /data/logs

ENV WINSTON_AGENTS_DIR=/data/agents \
    WINSTON_DATA_DIR=/data/config \
    WINSTON_LOG_DIR=/data/logs \
    WINSTON_DOCKER=1 \
    PORT=49710

EXPOSE 49710

ENTRYPOINT ["./winston"]
