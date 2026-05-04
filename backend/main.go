package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"github.com/tendersense/backend/internal/config"
	"github.com/tendersense/backend/internal/db"
	"github.com/tendersense/backend/internal/handlers"
	"github.com/tendersense/backend/internal/middleware"
	"github.com/tendersense/backend/internal/repository"
	"github.com/tendersense/backend/internal/service"
	"github.com/tendersense/backend/internal/util/pii"
)

func main() {
	// Route the stdlib log writer through a PII-redacting filter before
	// anything else logs (env loader uses log.Println on a missing .env).
	log.SetOutput(pii.NewWriter(os.Stderr))

	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using platform environment variables")
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("GIN_MODE")), "release") &&
		strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_INSECURE_RESET_TOKEN_RESPONSE")), "true") {
		log.Fatal("ALLOW_INSECURE_RESET_TOKEN_RESPONSE must not be true when GIN_MODE=release")
	}
	config.ValidateCoreSecrets()
	appCfg, err := config.LoadApp()
	if err != nil {
		log.Fatal(err)
	}

	database, err := db.Connect()
	if err != nil {
		log.Fatalf("Critical Error: Database connection failed: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("Critical Error: Migration failed: %v", err)
	}
	if err := db.RecoverInterruptedJobs(database); err != nil {
		log.Printf("warning: failed to recover interrupted evaluation jobs: %v", err)
	}

	repo := repository.NewTenderRepository(database)
	tenderService := service.NewTenderService(repo)

	// Gin writes its access + recovery logs to gin.DefaultWriter /
	// gin.DefaultErrorWriter; redact both before they hit stdout/stderr.
	gin.DefaultWriter = pii.NewWriter(os.Stdout)
	gin.DefaultErrorWriter = pii.NewWriter(os.Stderr)

	r := gin.New()
	r.Use(middleware.RequestObservability())
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.MaxMultipartMemory = 50 << 20 // 50 MB max upload

	corsCfg := cors.Config{
		AllowOriginFunc:  appCfg.OriginAllowed,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Authorization", "Content-Type", "Accept"},
		AllowCredentials: false,
	}
	r.Use(cors.New(corsCfg))

	r.GET("/health", healthHandler(database))

	api := r.Group("/api/v1")
	api.GET("/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"version": "0.2.0",
			"commit":  os.Getenv("GIT_SHA"),
		})
	})
	{
		authLimited := api.Group("")
		authLimited.Use(middleware.AuthRouteLimiter(40, 15))
		{
			authLimited.POST("/auth/register", handlers.Register(database))
			authLimited.POST("/auth/login", handlers.Login(database))
			authLimited.POST("/auth/forgot-password", handlers.ForgotPassword(database))
			authLimited.POST("/auth/reset-password", handlers.ResetPassword(database))
		}

		auth := api.Group("")
		auth.Use(middleware.AuthRequired())
		{
			auth.POST("/tenders", handlers.CreateTender(database))
			auth.GET("/tenders", handlers.ListTenders(database))
			auth.GET("/tenders/:id", handlers.GetTender(database))
			auth.POST("/tenders/:id/documents", handlers.UploadTenderDocument(database))
			auth.POST("/tenders/:id/bidders", handlers.RegisterBidder(database))
			auth.GET("/tenders/:id/bidders", handlers.ListBidders(database))
			auth.POST("/tenders/:id/evaluate", middleware.EvaluateRouteLimiter(10, 5), handlers.TriggerEvaluation(tenderService, database))
			auth.GET("/tenders/:id/evaluate/jobs/:job", handlers.GetEvaluationJobStatus(database))
			auth.GET("/tenders/:id/results", handlers.GetResults(database))
			auth.GET("/tenders/:id/bidders/:bid/decisions", handlers.GetBidderBreakdown(database))
			auth.GET("/tenders/:id/bidders/:bid/criteria/:crit/evidence", handlers.DecisionEvidence(database))

			auth.POST("/bidders/:id/documents", handlers.UploadBidderDocument(database))
			auth.GET("/bidders/:bid", handlers.GetBidder(database))

			auth.GET("/review/queue", handlers.ReviewQueue(database))
			auth.POST("/review/override", handlers.SubmitOverride(database))
			auth.GET("/audit", handlers.AuditLog(database))
		}
	}

	port := appCfg.Port

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadTimeout:       15 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    1 << 20,
		// Keep aligned with long-running evaluation path.
		WriteTimeout: 16 * time.Minute,
		IdleTimeout:  60 * time.Second,
	}

	// Initializing the server in a goroutine so that
	// it won't block the graceful shutdown handling below
	go func() {
		log.Printf("Listening and serving HTTP on :%s\n", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown the server with
	// a timeout of 5 seconds.
	quit := make(chan os.Signal, 1)
	// kill (no parameter) default send syscall.SIGTERM
	// kill -2 is syscall.SIGINT
	// kill -9 is syscall.SIGKILL but can't be caught, so no need to add it
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	// The context is used to inform the server it has 5 seconds to finish
	// the request it is currently handling
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown: ", err)
	}

	log.Println("Server exiting")
}

func healthHandler(database *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := database.PingContext(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status":   "unhealthy",
				"database": "unreachable",
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	}
}
