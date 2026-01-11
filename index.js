const functions = require("firebase-functions");
const admin = require("firebase-admin");

// 1. ⚠️ REPLACE THIS WITH YOUR REAL STRIPE SECRET KEY (starts with sk_test_)
const stripe = require("stripe")("sk_test_51RIcdZQ5PrTUuyRr3INl6IAgsaTCNx7lx4xu8rJtDRCtrMuUF3l4ulRy3UWZDAZmINhwrAyupxWdNF4ChAu48pkX00vJr3lmrj"); 

admin.initializeApp();

// --- FUNCTION 1: Create Secure Checkout Session ---
// This is called by your website when a user clicks "Subscribe"
exports.createStripeCheckout = functions.https.onCall(async (data, context) => {
    // A. Logging for debugging
    console.log("createStripeCheckout called.");
    console.log("User:", context.auth ? context.auth.uid : "Anonymous");
    console.log("Data:", data);

    // 1. Security Check: User must be logged in
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const userId = context.auth.uid;
    const { priceId, tierName } = data;

    // 2. URL Handling
    // Use the URL sent from the frontend, or fallback to your live site if missing.
    const domainUrl = data.domainUrl || "https://timthetitan01.github.io/UnstuntedSFX";
    // Remove trailing slash to prevent errors like "com//?success"
    const cleanUrl = domainUrl.replace(/\/$/, ""); 

    try {
        // 3. Create the Session with Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "subscription", // Use 'payment' if this is a one-time purchase
            line_items: [{
                price: priceId,
                quantity: 1,
            }],
            // Redirect URLs
            success_url: `${cleanUrl}/?success=true`,
            cancel_url: `${cleanUrl}/`,
            // Metadata is CRITICAL: This is how the Webhook knows who to upgrade
            metadata: {
                firebaseUID: userId,
                tier: tierName
            }
        });

        console.log("Session created:", session.id);
        return { url: session.url };

    } catch (error) {
        console.error("Stripe Error:", error);
        // Throwing 'internal' sends the detailed error back to your browser console
        throw new functions.https.HttpsError('internal', `Stripe Error: ${error.message}`);
    }
});

// --- FUNCTION 2: Stripe Webhook ---
// This runs automatically in the background when Stripe confirms payment
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    
    // 2. ⚠️ REPLACE THIS WITH YOUR REAL WEBHOOK SIGNING SECRET (starts with whsec_)
    const endpointSecret = "whsec_YQuloO9p9oHkWVyE3bJezgNGhdwxjskl"; 

    let event;

    try {
        // Verify the event came from Stripe
        event = stripe.webhooks.constructEvent(req.rawBody, signature, endpointSecret);
    } catch (err) {
        console.error("Webhook Signature Verification Failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the specific event: Checkout Completed
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        
        // Read the metadata we attached in Function 1
        const uid = session.metadata.firebaseUID;
        const tier = session.metadata.tier;

        console.log(`Processing upgrade for User: ${uid}, Tier: ${tier}`);

        // Logic: Grant 30 days of access
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const expirationDate = Date.now() + thirtyDays;

        // Update Firestore securely
        try {
            await admin.firestore().collection("users").doc(uid).set({
                isPremium: true,
                tier: tier,
                subscriptionEnd: expirationDate,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            console.log(`SUCCESS: User ${uid} upgraded.`);
        } catch (dbError) {
            console.error("Database Update Failed:", dbError);
            return res.status(500).send("Database Error");
        }
    }

    // Acknowledge receipt to Stripe
    res.json({ received: true });
});