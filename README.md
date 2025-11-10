 # YouTube Promotion Services - PayPal Integration

A complete web application for selling YouTube promotion services with PayPal integration, Firebase backend, and admin dashboard.

## 🚀 Features

- **Dynamic Pricing**: Slider and quick-select buttons for packages ($10-$100)
- **PayPal Integration**: Secure payments via PayPal SDK (Sandbox & Production ready)
- **Firebase Backend**: Firestore database for order management
- **Admin Dashboard**: Protected admin panel with order management
- **Responsive Design**: Mobile-friendly interface
- **Real-time Validation**: Form validation and error handling
- **Order Tracking**: Complete order lifecycle management

## 🛠 Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js with Vercel Serverless Functions
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth
- **Payments**: PayPal SDK
- **Deployment**: Vercel
- **Version Control**: Git

## 📁 Project Structure

```
├── public/
│   ├── index.html              # Main landing page
│   ├── admin.html              # Admin dashboard
│   ├── success.html            # Payment success page
│   ├── css/
│   │   ├── styles.css          # Main styles
│   │   └── admin.css           # Admin dashboard styles
│   └── js/
│       ├── app.js              # Main frontend logic
│       ├── admin.js            # Admin dashboard logic
│       └── firebase-config.js  # Firebase configuration
├── api/
│   ├── create-order.js         # PayPal create order endpoint
│   ├── capture-order.js        # PayPal capture order endpoint
│   └── submit-order.js         # Store order data endpoint
├── package.json                # Dependencies and scripts
├── vercel.json                 # Vercel deployment config
├── .env.example               # Environment variables template
└── README.md                  # This file
```

## 🔧 Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd youtube-promotion-paypal
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

**Required Environment Variables:**

- **PayPal Sandbox Credentials** (from PayPal Developer Dashboard)
- **Firebase Project Configuration** (from Firebase Console)
- **Firebase Admin SDK** (service account key)

### 3. PayPal Setup

1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/)
2. Create a new application
3. Get your Client ID and Secret
4. Add them to your `.env` file

**Test Cards for Sandbox:**
- Visa: `4111111111111111`
- Mastercard: `5555555555554444`
- American Express: `378282246310005`
- Use any future expiry date and any CVV

### 4. Firebase Setup

1. Create a new Firebase project
2. Enable Firestore Database
3. Enable Authentication (Email/Password)
4. Download service account key
5. Add configuration to `.env` file

**Firestore Security Rules:**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /orders/{document} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 5. Update Frontend Configuration

Edit `public/js/firebase-config.js` with your Firebase web app config.

Update the PayPal Client ID in `public/index.html`:
```html
<script src="https://www.paypal.com/sdk/js?client-id=YOUR_SANDBOX_CLIENT_ID&buyer-country=US&currency=USD&components=buttons&enable-funding=venmo,paylater,card&disable-funding=credit"></script>
```

## 🚀 Deployment

### Local Development

```bash
npm run dev
```

### Deploy to Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel --prod
```

3. Set environment variables in Vercel dashboard

### Custom Domain

1. Add your domain in Vercel dashboard
2. Update DNS settings to point to Vercel
3. Update PayPal return URLs in your PayPal app settings

## 👨‍💼 Admin Usage

### Creating Admin User

1. Go to Firebase Console > Authentication
2. Add a new user with email/password
3. Use these credentials to login to `/admin`

### Admin Features

- **Dashboard Overview**: Revenue, orders, and status statistics
- **Order Management**: View, search, and filter orders
- **Status Updates**: Update order status and add notes
- **Real-time Data**: Automatic refresh and real-time updates

## 🔒 Security Features

- **Firebase Authentication**: Secure admin access
- **Environment Variables**: Sensitive data protection
- **CORS Headers**: Proper cross-origin handling
- **Input Validation**: Frontend and backend validation
- **PayPal Security**: Official PayPal SDK integration

## 📱 Mobile Responsive

- Responsive design for all screen sizes
- Touch-friendly interface
- Mobile-optimized forms and buttons

## 🔧 Customization

### Pricing

Update the amount range in `public/js/app.js`:
```javascript
// Change min/max values
const slider = document.getElementById('amountSlider');
slider.min = "10";  // Minimum amount
slider.max = "100"; // Maximum amount
```

### Branding

- Update company name in `api/create-order.js`
- Modify colors in CSS files
- Change logo and favicon
- Update email addresses and contact info

### Service Packages

Modify the packages in `api/create-order.js`:
```javascript
items: [
    {
        name: "Your Service Name",
        description: "Your service description",
        // ... other properties
    }
]
```

## 🐛 Troubleshooting

### Common Issues

1. **PayPal Button Not Loading**
   - Check Client ID in HTML
   - Verify network connection
   - Check browser console for errors

2. **Firebase Connection Issues**
   - Verify Firebase config
   - Check Firestore rules
   - Ensure project ID is correct

3. **Vercel Deployment Issues**
   - Check environment variables
   - Verify API routes
   - Check function logs

### Debug Mode

Enable debug logging by adding to `.env`:
```bash
NODE_ENV=development
```

## 📞 Support

For issues and questions:
- Check the troubleshooting section
- Review Firebase and PayPal documentation
- Create an issue in the repository

## 📄 License

MIT License - feel free to modify and use for your projects.

---

**Built with ❤️ for YouTube content creators**