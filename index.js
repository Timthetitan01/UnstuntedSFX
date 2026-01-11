const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

// Initialize Firebase Admin
admin.initializeApp();

// ⚠️ REPLACE THIS WITH YOUR REAL STRIPE SECRET KEY (sk_test_...)
const stripe = require("stripe")("sk_test_51RIcdZQ5PrTUuyRr3INl6IAgsaTCNx7lx4xu8rJtDRCtrMuUF3l4ulRy3UWZDAZmINhwrAyupxWdNF4ChAu48pkX00vJr3lmrj");

// ⚠️ REPLACE THIS WITH YOUR REAL STRIPE WEBHOOK SECRET (whsec_...)
const endpointSecret = "whsec_YQuloO9p9oHkWVyE3bJezgNGhdwxjskl";

// ==========================================
// 1. CREATE CHECKOUT SESSION (HTTP Endpoint)
// ==========================================
exports.createStripeCheckout = onRequest((req, res) => {
  // Handle CORS (Allow your GitHub site to talk to this server)
  cors(req, res, async () => {
    
    // Allow only POST requests
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    try {
      // --- SECURITY CHECK: VERIFY USER IS LOGGED IN ---
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
      }

      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid; // User is verified!
      const email = decodedToken.email; // We can grab their email too

      // --- GET DATA FROM REQUEST ---
      // Supports both direct JSON and "data" wrapper
      const body = req.body.data || req.body;
      const { priceId, tierName } = body;

      if (!priceId) {
        return res.status(400).json({ error: "Price ID is missing" });
      }

      // --- CREATE STRIPE SESSION ---
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: email, // Pre-fill their email for better UX
        success_url: "https://timthetitan01.github.io/UnstuntedSFX/?success=true",
        cancel_url: "https://timthetitan01.github.io/UnstuntedSFX/?cancel=true",
        metadata: { 
            userId: uid,
            tier: tierName 
        },
      });

      // --- SEND URL BACK TO FRONTEND ---
      res.status(200).json({ result: { url: session.url } });

    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ error: error.message });
    }
  });
});

// ==========================================
// 2. STRIPE WEBHOOK (Handle Payment Success)
// ==========================================
exports.stripeWebhook = onRequest(async (req, res) => {
  let event;

  try {
    // Verify the request actually came from Stripe
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error(`Webhook Signature Verification Failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata.userId;
    const tier = session.metadata.tier; // 'starter', 'pro', or 'ultimate'

    // Update Firebase Database
    if (userId && tier) {
      console.log(`✅ Payment success! Upgrading user ${userId} to ${tier}`);
      
      const oneMonth = 30 * 24 * 60 * 60 * 1000;
      const oneYear = 365 * 24 * 60 * 60 * 1000;
      let duration = oneMonth;
      if (tier === 'pro') duration = oneYear;
      if (tier === 'ultimate') duration = 99 * oneYear; // Lifetime

      await admin.firestore().collection("users").doc(userId).set({
        isPremium: true,
        tier: tier,
        subscriptionEnd: Date.now() + duration,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  }

  res.json({ received: true });
});
