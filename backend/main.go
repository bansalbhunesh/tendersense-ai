package main

import (
	"context"
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

	"github.com/tendersense/backend/internal/db"
	"github.com/tendersense/backend/internal/handlers"
	"github.com/tendersense/backend/internal/middleware"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using platform environment variables")
	}

	database, err := db.Connect()
	if err != nil {
		log.Fatalf("Critical Error: Database connection failed: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("Critical Error: Migration failed: %v", err)
	}

	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.MaxMultipartMemory = 50 << 20 // 50 MB max upload

	// Modern CORS configuration
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true // For demo. Restricted in production via ENV.
	if origins := os.Getenv("ALLOWED_ORIGINS"); origins != "" {
		config.AllowOrigins = strings.Split(origins, ",")
		config.AllowAllOrigins = false
	}
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Authorization", "Content-Type", "Accept"}
	r.Use(cors.New(config))

	r.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })

	api := r.Group("/api/v1")
	{
		api.POST("/auth/register", handlers.Register(database))
		api.POST("/auth/login", handlers.Login(database))

		auth := api.Group("")
		auth.Use(middleware.AuthRequired())
		{
			auth.POST("/tenders", handlers.CreateTender(database))
			auth.GET("/tenders", handlers.ListTenders(database))
			auth.GET("/tenders/:id", handlers.GetTender(database))
			auth.POST("/tenders/:id/documents", handlers.UploadTenderDocument(database))
			auth.POST("/tenders/:id/bidders", handlers.RegisterBidder(database))
			auth.GET("/tenders/:id/bidders", handlers.ListBidders(database))
			auth.POST("/tenders/:id/evaluate", handlers.TriggerEvaluation(database))
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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 180 * time.Second, // Long for AI evaluation responses
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
