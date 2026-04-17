package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"github.com/tendersense/backend/internal/db"
	"github.com/tendersense/backend/internal/handlers"
	"github.com/tendersense/backend/internal/middleware"
)

func main() {
	_ = godotenv.Load()
	database, err := db.Connect()
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database); err != nil {
		log.Fatal("migrate: ", err)
	}

	r := gin.Default()
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

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

	addr := ":8080"
	if v := os.Getenv("PORT"); v != "" {
		addr = ":" + v
	}
	log.Println("listening on", addr)
	if err := r.Run(addr); err != nil {
		log.Fatal(err)
	}
}
