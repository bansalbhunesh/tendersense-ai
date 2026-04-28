FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 go build -o /tendersense-api .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=build /tendersense-api .
EXPOSE 8080
ENTRYPOINT ["/app/tendersense-api"]
