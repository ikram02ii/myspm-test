# MySPM

Mobile app (`NEW_CODE_SYUKRAN/`) and backend (`myspm-backend/`).

## Mobile app (NEW_CODE_SYUKRAN)

A React Native application for exam management, built with Expo and TypeScript.

## Features

- **Mobile Portal**: Native mobile experience for students and teachers
- **Exam Mode**: Take exams on mobile devices
- **Practice Sessions**: Practice exams on the go
- **QR Code Scanning**: Scan exams with device camera
- **Offline Support**: Work offline with local caching
- **Leaderboard**: View rankings and progress
- **User Profile**: Manage student/teacher profile

## Prerequisites

- Node.js 18+ or pnpm 8+
- Expo CLI: `npm install -g expo-cli`
- Backend API running at `http://localhost:3000` (configurable)
- iOS Simulator or Android Emulator (for testing)
- Expo Go app (for testing on physical devices)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd NEW_CODE_SYUKRAN
```

2. Install dependencies:
```bash
npm install
# or
pnpm install
```

3. Create environment file:
```bash
cp .env.example .env.local
```

4. Update `.env.local` with your backend API URL:
```
EXPO_PUBLIC_API_URL=http://your-api-server:3000/api
```

## Development

Start the development server:
```bash
npm run dev
```

This will start the Expo development server and display a QR code.

### Testing on Device

1. Install Expo Go app on your device
2. Scan the QR code displayed in the terminal
3. The app will load on your device

### Testing in Emulator

#### iOS Simulator
```bash
expo start --ios
```

#### Android Emulator
```bash
expo start --android
```

## Building

### Build APK (Android)
```bash
eas build --platform android
```

### Build IPA (iOS)
```bash
eas build --platform ios
```

### Build for Both Platforms
```bash
eas build --platform ios --platform android
```

## Type Checking

Run TypeScript type checking:
```bash
npm run typecheck
```

## Project Structure

```
app/                    # Expo Router file-based routing
├── (tabs)/             # Tab navigation stack
│   ├── index.tsx       # Home tab
│   ├── practice.tsx    # Practice tab
│   ├── camera.tsx      # QR scan tab
│   ├── leaderboard.tsx # Leaderboard tab
│   ├── profile.tsx     # Profile tab
│   └── _layout.tsx     # Tab layout
├── exam-mode.tsx       # Exam taking screen
├── practice-session.tsx # Practice session screen
├── onboarding.tsx      # Onboarding flow
└── _layout.tsx         # Root layout

components/            # Reusable components
├── ErrorBoundary.tsx
├── ErrorFallback.tsx
└── ...

constants/            # App constants (colors, sizes, etc.)

assets/              # Images, fonts, and static files
```

## Technologies

- **React Native** 0.81.5 - Mobile framework
- **Expo** 54.0.27 - Development platform
- **Expo Router** 6.0.17 - File-based routing
- **TypeScript** 5.9.2 - Type safety
- **TanStack React Query** - Data fetching & caching
- **React Native Reanimated** - Animations
- **React Native Gesture Handler** - Gesture support
- **React Native SVG** - Vector graphics
- **Zod** - Schema validation
- **Async Storage** - Local storage

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `EXPO_PUBLIC_API_URL` | Backend API base URL | `http://localhost:3000/api` |

## API Integration

The mobile app communicates with the MySPM backend API. Ensure the backend is running before starting the app.

API endpoints are configured via the `EXPO_PUBLIC_API_URL` environment variable.

## Troubleshooting

### Port Already in Use
If port 19000 is already in use, Expo will use the next available port.

### Clear Cache
```bash
expo start --clear
```

### Reset Metro Bundler
```bash
expo start -c
```

## Contributing

Please follow the existing code style and structure when contributing.

## License

See LICENSE file for details.
