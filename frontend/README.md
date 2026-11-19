# Auto Clips Frontend

Based on React + TypeScript + Vite + Ant Design ofVideoAutoClipsFront endApplication。

## Feature Characteristics

### 🎯 Core Functions
- **VideoUpload**: Support drag-and-drop uploadVideo fileandSubtitle file
- **Smart processing**: AI AutoExtractVideoHighlightsclips
- **FilmclipsManage**: View、Edit、DownloadVideo clip
- **CollectionsCreate**: AI recommendedCollections + ManualCreate collection
- **Real-time monitoring**: ProcessProgressReal-timeFeedback

### 🎨 User Interface
- **Modern design**: Based on Ant Design Component Library
- **Responsive layout**: Supports desktop and mobile
- **IntuitiveActions**: Drag and dropSort、One-clickDownload
- **StatusFeedback**: Clear handlingStatusandProgressShow

## Tech Stack

- **Front-end framework**: React 18 + TypeScript
- **Build Tools**: Vite
- **UI Component**: Ant Design
- **StatusManage**: Zustand
- **Routing**: React Router DOM
- **HTTP Client**: Axios
- **Drag and drop function**: React Beautiful DnD
- **VideoPlay**: React Player
- **File Upload**: React Dropzone

## FastQuick Start

### Environmental requirements
- Node.js >= 16
- npm Or yarn

### InstallDependence
```bash
npm install
# Or
yarn install
```

### Start the development server
```bash
npm run dev
# Or
yarn dev
```

Visit http://localhost:3000

### Build productionVersion
```bash
npm run build
# Or
yarn build
```

## ProjectStructure

```
frontend/
├── public/                 # Static resources
├── src/
│   ├── components/         # Reusable components
│   │   ├── Header.tsx      # Page header
│   │   ├── FileUpload.tsx  # File Upload Component
│   │   ├── ProjectCard.tsx # ProjectCard
│   │   ├── ClipCard.tsx    # Video clipCard
│   │   └── CollectionCard.tsx # CollectionsCard
│   ├── pages/              # Page Components
│   │   ├── HomePage.tsx    # ProjectHome
│   │   └── ProjectDetailPage.tsx # ProjectDetailsPage
│   ├── services/           # API Service
│   │   └── api.ts          # API Interface Definition
│   ├── store/              # StatusManage
│   │   └── useProjectStore.ts # ProjectStatus
│   ├── App.tsx             # ApplicationMain component
│   ├── main.tsx            # ApplicationEntry
│   └── index.css           # GlobalStyle
├── package.json
├── vite.config.ts          # Vite Configuration
├── tsconfig.json           # TypeScript Configuration
└── README.md
```

## Page description

### ProjectHome (`/`)
- ProjectListDisplay
- Search and filter functions
- New project（File Upload）
- ProjectStatusMonitor

### ProjectDetailsPage (`/project/:id`)
- ProjectInformation and ProcessingStatus
- Video clipManage
- AI CollectionsDisplay
- ManualCreate collection
- DownloadandExportFunction

## Component Description

### FileUpload
- Supports drag-and-drop and click-to-upload
- File type validation
- UploadProgressShow
- AutoCreateProject

### ProjectCard
- ProjectInformation Display
- StatusIndicator
- FastQuickActionsButton
- ProgressclipsShow

### ClipCard
- Video clipInformation
- Video timeline preview
- EditandDownload
- AddToCollections

### CollectionCard
- CollectionsInformation Display
- FilmclipsListManage
- Drag and dropSort
- GenerateCollectionsVideo

## API Interface

Front-end approved `/api` Proxy communication with the backend，The main interfaces include：

- `GET /api/projects` - ObtainProjectList
- `POST /api/projects` - Create NewProject
- `GET /api/projects/:id` - ObtainProjectDetails
- `POST /api/projects/:id/upload` - Upload file
- `POST /api/projects/:id/process` - Start processing
- `GET /api/projects/:id/status` - Get processingStatus
- `PUT /api/projects/:id/clips/:clipId` - Update the clipclips
- `PUT /api/projects/:id/collections/:collectionId` - UpdateCollections
- `GET /api/projects/:id/download` - DownloadVideo

## Development Instructions

### StatusManage
Use Zustand Go lightweightStatusManage，Primary Management：
- ProjectListand currentProject
- Video clipandCollectionsData
- LoadStatusandError details

### StyleStandard
- Use Ant Design Theme color
- Responsive design，Supports mobile devices
- Uniform spacing and rounded corner specifications
- Custom scrollclipsand hover effects

### Type definition
All data structures are complete TypeScript Type definition，Ensure type safety。

## Deployment Instructions

### Development environment
```bash
npm run dev
```

### Production environment
```bash
npm run build
npm run preview
```

### Docker Deploy
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "preview"]
```

## Subsequent optimization

### Feature enhancement
- [ ] Video timeline editing
- [ ] BatchActions
- [ ] ExportVariousFormat
- [ ] User Permission Management
- [ ] Cloud Storage Integration

### Performance optimization
- [ ] Virtual Scrolling
- [ ] Lazy loading of images
- [ ] CodepointsCut
- [ ] Caching policy

### User Experience
- [ ] FastHotkey Support
- [ ] Theme Switch
- [ ] Internationalization
- [ ] Accessibility

## Contribution Guidelines

1. Fork Project
2. Create featurepointsSupport
3. Submit updateChange
4. Push topointsSupport
5. Create Pull Request

## License

MIT License