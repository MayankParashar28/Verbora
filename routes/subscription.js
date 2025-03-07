const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../models/user"); // Assuming you have a User model

// Subscription Payment Page
router.get("/subscribe", (req, res) => {
    res.send("Under Working , try after some days");
});





// Stripe Checkout Session
router.post("/create-checkout-session", async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: { name: "AI Access Subscription" },
                        unit_amount: 999, // $9.99 Subscription
                    },
                    quantity: 1,
                },
            ],
            mode: "subscription",
            success_url: `${req.protocol}://${req.get("host")}/blog/generate-ai`,
            cancel_url: `${req.protocol}://${req.get("host")}/subscribe`,
        });

        res.redirect(session.url);
    } catch (error) {
        console.error("❌ Error creating checkout session:");
        res.status(500).send("Something went wrong");
    }
});

// Webhook to update user subscription status
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userEmail = session.customer_email;

        // ✅ Update user subscription status in the database
        await User.findOneAndUpdate({ email: userEmail }, { isSubscribed: true });

        console.log(`✅ Subscription activated for ${userEmail}`);
    }

    res.json({ received: true });
});

module.exports = router;