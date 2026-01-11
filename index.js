const functions = require("firebase-functions");
const admin = require("firebase-admin");

// 1. PASTE YOUR REAL SECRET KEY HERE
const stripe = require("stripe")("sk_test_51RIcdZQ5PrTUuyRr3INl6IAgsaTCNx7lx4xu8rJtDRCtrMuUF3l4ulRy3UWZDAZmINhwrAyupxWdNF4ChAu48pkX00vJr3lmrj"); 

admin.initializeApp();

// Use onCall (Matching your HTML)
exports.createStripeCheckout = functions.https.onCall(async (data, context) => {
    // Logging to see what's happening in Firebase Console
    console.log("Function invoked");
    
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
    }

    const userId = context.auth.uid;
    const { priceId, tierName } = data;
    
    // URL Logic
    const domainUrl = data.domainUrl || "https://timthetitan01.github.io/UnstuntedSFX";
    const cleanUrl = domainUrl.replace(/\/$/, ""); 

    try {
        console.log(`Creating session for user ${userId} with price ${priceId}`);
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "subscription",
            line_items: [{
                price: priceId,
                quantity: 1,
            }],
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
        console.error("Stripe Error:", error);
        // This passes the exact error text to your browser
        throw new functions.https.HttpsError('internal', error.message);
    }
});

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    const signature = req.headers["stripe-signature"];
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
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;

        await admin.firestore().collection("users").doc(uid).set({
            isPremium: true,
            tier: tier,
            subscriptionEnd: Date.now() + thirtyDays,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    res.json({ received: true });
});