const functions = require("firebase-functions");
const admin = require("firebase-admin");
// 1. PASTE YOUR SECRET KEY HERE (Keep the quotes!)
const stripe = require("stripe")("sk_test_51RIcdZQ5PrTUuyRr3INl6IAgsaTCNx7lx4xu8rJtDRCtrMuUF3l4ulRy3UWZDAZmINhwrAyupxWdNF4ChAu48pkX00vJr3lmrj"); 

admin.initializeApp();

exports.createStripeCheckout = functions.https.onCall(async (data, context) => {
    // A. Logging to debug "Internal" errors
    console.log("Function called by user:", context.auth ? context.auth.uid : "Anonymous");
    console.log("Data received:", data);

    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const userId = context.auth.uid;
    const { priceId, tierName } = data;

    // B. Safety Check: Did we get a URL from the frontend?
    // If not, use your GitHub URL as a fallback so it doesn't crash.
    const domainUrl = data.domainUrl || "https://timthetitan01.github.io/UnstuntedSFX";
    
    // Remove any trailing slash to avoid double slashes like "com//?success"
    const cleanUrl = domainUrl.replace(/\/$/, ""); 

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "subscription",
            line_items: [{
                price: priceId,
                quantity: 1,
            }],
            // C. The Redirect URLs
            success_url: `${cleanUrl}/?success=true`,
            cancel_url: `${cleanUrl}/`,
            metadata: {
                firebaseUID: userId,
                tier: tierName
            }
        });

        console.log("Session created successfully:", session.id);
        return { url: session.url };

    } catch (error) {
        // D. Print the REAL error from Stripe to the Firebase logs
        console.error("Stripe Error:", error);
        throw new functions.https.HttpsError('internal', `Stripe Error: ${error.message}`);
    }
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