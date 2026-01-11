const functions = require("firebase-functions");
const admin = require("firebase-admin");
// REPLACE WITH YOUR ACTUAL SECRET KEY (sk_test_...)
const stripe = require("stripe")("sk_test_51RIcdZQ5PrTUuyRr3INl6IAgsaTCNx7lx4xu8rJtDRCtrMuUF3l4ulRy3UWZDAZmINhwrAyupxWdNF4ChAu48pkX00vJr3lmrj"); 

admin.initializeApp();

// 1. CREATE CHECKOUT SESSION
// This function is called by your website. It talks to Stripe securely.
exports.createStripeCheckout = functions.https.onCall(async (data, context) => {
    // 1. Security Check: User must be logged in
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
    }

    const userId = context.auth.uid;
    const { priceId, tierName } = data;

    // 2. Create the Session
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "subscription", 
        line_items: [{
            price: priceId,
            quantity: 1,
        }],
        // Where to send the user after they pay (Update with your real URL if hosted)
        success_url: "http://localhost:5000/?success=true", 
        cancel_url: "http://localhost:5000/",
        metadata: {
            firebaseUID: userId,
            tier: tierName
        }
    });

    // 3. Send the Stripe URL back to the frontend
    return { url: session.url };
});

// 2. STRIPE WEBHOOK
// This runs automatically when Stripe tells us "Payment Complete"
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    // WE WILL GET THIS SECRET IN PHASE 5
    const endpointSecret = "whsec_YQuloO9p9oHkWVyE3bJezgNGhdwxjskl"; 

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, signature, endpointSecret);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const uid = session.metadata.firebaseUID;
        const tier = session.metadata.tier;

        // Calculate 30 days from now
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const expirationDate = Date.now() + thirtyDays;

        // Securely update the database
        await admin.firestore().collection("users").doc(uid).set({
            isPremium: true,
            tier: tier,
            subscriptionEnd: expirationDate,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`SUCCESS: User ${uid} subscribed to ${tier}`);
    }

    res.json({ received: true });
});