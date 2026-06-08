// Run: node scripts/seed-tasks.js [slug]
// Default slug: sanatan-sansaar

const fs = require('fs');
const path = require('path');

const slug = process.argv[2] || 'sanatan-sansaar';
const outPath = path.join(__dirname, '..', 'prds', slug, 'tasks.json');

let _order = 0;
function t(id, title, desc, parentId, numberOverride) {
  return {
    id,
    title,
    description: desc || '',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    startDate: null,
    dueDate: null,
    parentId: parentId || null,
    order: _order++,
    numberOverride: numberOverride || null,
    createdAt: new Date().toISOString(),
  };
}

// ── BACKEND ──────────────────────────────────────────────────────────
const tasks = [
  t('g-1',     'BACKEND',                        '',    null,   '1'),

  t('g-1.0',   'Foundation',                     '',    'g-1',  '1.0'),
  t('t-1.0.1', 'Add ASTROLOGER role',             'Add ASTROLOGER to AppUser.Role enum, update SecurityConfig routes', 'g-1.0', '1.0.1'),
  t('t-1.0.2', 'Create all enums',               'ConsultationType, ConsultationStatus, AvailabilityStatus, TransactionType, WalletTransactionSource, WithdrawalStatus, AstrologerVerificationStatus', 'g-1.0', '1.0.2'),
  t('t-1.0.3', 'Create all 23 entities + repos', 'JPA entities extending BaseEntity, all repositories with JpaSpecificationExecutor', 'g-1.0', '1.0.3'),
  t('t-1.0.4', 'Liquibase migration',            'Generate changelog, post-process, seed SystemCommission defaults', 'g-1.0', '1.0.4'),
  t('t-1.0.5', 'Provider interfaces',            'CallProvider, ChatProvider, ConsultationPushService interfaces + all DTOs', 'g-1.0', '1.0.5'),
  t('t-1.0.6', 'Config classes',                 'AgoraConfig, CometChatConfig, ConsultationConfig, ConsultationConstants', 'g-1.0', '1.0.6'),
  t('t-1.0.7', 'State machine',                  'ConsultationStateMachine with valid transitions + unit tests', 'g-1.0', '1.0.7'),
  t('t-1.0.8', 'Billing calculator',             'Pure static billing math + all edge case unit tests', 'g-1.0', '1.0.8'),

  t('g-1.1',    'Astrologer Management',          '',    'g-1',  '1.1'),
  t('t-1.1.1',  'Astrologer registration',        'Register endpoint, dual-role flow (USER→USER+ASTROLOGER), create AstrologerEntity + wallet', 'g-1.1', '1.1.1'),
  t('t-1.1.2',  'Profile CRUD',                  'Get/update displayName, bio, experience, languages, specializations, profileImage', 'g-1.1', '1.1.2'),
  t('t-1.1.3',  'Gallery management',            'Add/delete/reorder gallery images, max 10 per astrologer', 'g-1.1', '1.1.3'),
  t('t-1.1.4',  'Rate management',               'Set/get chat, audio, video rates + emergency rates + discount percentages', 'g-1.1', '1.1.4'),
  t('t-1.1.5',  'Banking details',               'Add/update banking info, masked response (last 4 digits only)', 'g-1.1', '1.1.5'),
  t('t-1.1.6',  'Availability toggle',           'Online/offline switch, BUSY auto-managed by system, reject if active session', 'g-1.1', '1.1.6'),
  t('t-1.1.7',  'Weekly schedule',               'Set/get weekly time windows per day, multiple slots, overlap merge', 'g-1.1', '1.1.7'),
  t('t-1.1.8',  'Dashboard & earnings',          'Today/week/month/overall stats, detailed earnings report with filters', 'g-1.1', '1.1.8'),
  t('t-1.1.9',  'Assistant management',          'Add/remove/update assistants (max 3), permission-based access', 'g-1.1', '1.1.9'),

  t('g-1.2',    'User MoneyWallet',              '',    'g-1',  '1.2'),
  t('t-1.2.1',  'Wallet balance & history',      'Get balance, paginated transaction history with filters', 'g-1.2', '1.2.1'),
  t('t-1.2.2',  'Recharge via Razorpay',         'Create Razorpay order, verify payment, credit wallet + bonus', 'g-1.2', '1.2.2'),
  t('t-1.2.3',  'Recharge slabs',               'List active slabs (amount + bonus), sorted by sortOrder', 'g-1.2', '1.2.3'),
  t('t-1.2.4',  'Wallet deduction service',      'Atomic deduct with optimistic lock retry, shortfall protection', 'g-1.2', '1.2.4'),
  t('t-1.2.5',  'Pre-consultation balance check','Verify user can afford minimum minutes before request creation', 'g-1.2', '1.2.5'),

  t('g-1.3',    'Consultation Core',             '',    'g-1',  '1.3'),
  t('t-1.3.1',  'Create chat request',           'Validate astrologer/wallet/block/duplicate, snapshot rate, push to astrologer', 'g-1.3', '1.3.1'),
  t('t-1.3.2',  'Create call request (audio/video)', 'Same validations, generate channel name, create Agora room, VoIP push for iOS', 'g-1.3', '1.3.2'),
  t('t-1.3.3',  'Accept request',               'Transition PENDING→ACCEPTED, set BUSY, create chat channel or generate Agora token', 'g-1.3', '1.3.3'),
  t('t-1.3.4',  'Reject request',               'Transition PENDING→REJECTED, push to user with similar astrologer suggestions', 'g-1.3', '1.3.4'),
  t('t-1.3.5',  'User joins session',            'Set userJoinedAt, generate token, check if both joined→CONFIRMED, sibling cancel', 'g-1.3', '1.3.5'),
  t('t-1.3.6',  'Astrologer joins session',      'Set astrologerJoinedAt, same CONFIRMED logic as user join', 'g-1.3', '1.3.6'),
  t('t-1.3.7',  'End session',                  'Atomic CAS (CONFIRMED→COMPLETING), billing engine, wallet deduct+credit, COMPLETING→COMPLETED', 'g-1.3', '1.3.7'),
  t('t-1.3.8',  'Cancel request',               'User cancels PENDING/ACCEPTED, zero billing, astrologer back to ONLINE', 'g-1.3', '1.3.8'),
  t('t-1.3.9',  'Poll request status',           'Get current status with context-appropriate response per state', 'g-1.3', '1.3.9'),
  t('t-1.3.10', 'Consultation history',          'Paginated past consultations for user and astrologer with filters', 'g-1.3', '1.3.10'),
  t('t-1.3.11', 'Intake form',                  'Create intake form (birth details), prefill from UserEntity, astrologer view', 'g-1.3', '1.3.11'),

  t('g-1.4',    'Agora Integration',             '',    'g-1',  '1.4'),
  t('t-1.4.1',  'Agora token generation',        'Port RtcTokenBuilder + AccessToken from PHP to Java, unit tests', 'g-1.4', '1.4.1'),
  t('t-1.4.2',  'AgoraCallProvider impl',        'Implement CallProvider interface — createRoom, generateToken, endRoom', 'g-1.4', '1.4.2'),
  t('t-1.4.3',  'Agora webhook handler',         'POST /internal/agora/webhook — join/leave/destroy events, idempotent', 'g-1.4', '1.4.3'),

  t('g-1.5',    'CometChat Integration',         '',    'g-1',  '1.5'),
  t('t-1.5.1',  'CometChatProvider impl',        'Implement ChatProvider — user provisioning, channel create/close, messages, delete', 'g-1.5', '1.5.1'),
  t('t-1.5.2',  'CometChat auth token',          'Endpoint for Flutter to get CometChat auth token for SDK init', 'g-1.5', '1.5.2'),
  t('t-1.5.3',  'Chat keyword filtering',        'ChatModerationService — exact + regex match against ChatKeyword table', 'g-1.5', '1.5.3'),
  t('t-1.5.4',  'Chat media upload',             'Upload file (image/pdf/mp3) to S3, return mediaUrl for CometChat message', 'g-1.5', '1.5.4'),
  t('t-1.5.5',  'Catalog suggestion',            'Search endpoint for astrologer to suggest products/poojas during chat', 'g-1.5', '1.5.5'),

  t('g-1.6',    'Astrologer Wallet & Commission','',    'g-1',  '1.6'),
  t('t-1.6.1',  'Astrologer wallet service',     'Credit earnings with optimistic lock, balance + transaction history', 'g-1.6', '1.6.1'),
  t('t-1.6.2',  'Withdrawal request',            'Create withdrawal (deduct wallet), validate banking exists, push to admin', 'g-1.6', '1.6.2'),
  t('t-1.6.3',  'Commission cascade',            'Resolve commission: boost→per-astrologer→system default→30% fallback', 'g-1.6', '1.6.3'),
  t('t-1.6.4',  'Admin commission CRUD',         'System default, per-astrologer override, 24h profile boost', 'g-1.6', '1.6.4'),
  t('t-1.6.5',  'Admin withdrawal processing',   'List/approve/reject/process withdrawals, refund on rejection', 'g-1.6', '1.6.5'),

  t('g-1.7',    'Social Features',              '',    'g-1',  '1.7'),
  t('t-1.7.1',  'Follow/unfollow',              'Follow/unfollow astrologer, follower count, following list, followers list', 'g-1.7', '1.7.1'),
  t('t-1.7.2',  'Block/unblock',                'Astrologer blocks user, auto-reject pending request, prevent future requests', 'g-1.7', '1.7.2'),
  t('t-1.7.3',  'Reviews & ratings',            'Create review (1-5 stars), recalculate averageRating, public review list', 'g-1.7', '1.7.3'),
  t('t-1.7.4',  'Virtual gifts',                'Gift catalog, send gift during consultation, wallet deduct user + credit astrologer (no commission)', 'g-1.7', '1.7.4'),
  t('t-1.7.5',  'Waitlist',                     'Add/remove from waitlist, notify when astrologer comes online', 'g-1.7', '1.7.5'),
  t('t-1.7.6',  'Similar astrologers',          'Recommend by specialization/language/rate overlap, prefer ONLINE, exclude blocked', 'g-1.7', '1.7.6'),
  t('t-1.7.7',  'Astrologer listing & search',  'Paginated list with filters (language, specialization, rating, rate, type, online), JPA Specification', 'g-1.7', '1.7.7'),

  t('g-1.8',    'Push Notifications & Jobs',    '',    'g-1',  '1.8'),
  t('t-1.8.1',  'Firebase push service',        'FCM data messages to user/astrologer, batch send to followers', 'g-1.8', '1.8.1'),
  t('t-1.8.2',  'VoIP push (iOS)',              'APNs VoIP push for CallKit native call screen on incoming calls', 'g-1.8', '1.8.2'),
  t('t-1.8.3',  'Timeout job',                 'Every 30s — expire PENDING requests older than 2 min', 'g-1.8', '1.8.3'),
  t('t-1.8.4',  'No-show job',                 'Every 15s — timeout ACCEPTED with no user join (120s) or ghost join (90s)', 'g-1.8', '1.8.4'),
  t('t-1.8.5',  'Free session watchdog',        'Every 10s — auto-end CONFIRMED free sessions at 180s', 'g-1.8', '1.8.5'),
  t('t-1.8.6',  'Waitlist notification job',    'Every 60s fallback + daily 2AM cleanup of entries older than 24h', 'g-1.8', '1.8.6'),

  t('g-1.9',    'Admin Module',                 '',    'g-1',  '1.9'),
  t('t-1.9.1',  'Astrologer verification',      'List pending, verify/reject astrologer, activate/deactivate', 'g-1.9', '1.9.1'),
  t('t-1.9.2',  'Astrologer admin management',  'View full detail (unmasked banking), update profile/rates, force offline', 'g-1.9', '1.9.2'),
  t('t-1.9.3',  'Consultation dashboard',       'Real-time stats — active now, today/week/month totals, revenue, online count', 'g-1.9', '1.9.3'),
  t('t-1.9.4',  'Consultation list & detail',   'List all consultations with filters, full detail with timeline + billing', 'g-1.9', '1.9.4'),
  t('t-1.9.5',  'Force terminate',              'Admin force-ends active session with reason, triggers billing', 'g-1.9', '1.9.5'),
  t('t-1.9.6',  'Chat monitoring',              'List active chats, view chat history for any consultation', 'g-1.9', '1.9.6'),
  t('t-1.9.7',  'Revenue report',               'Revenue grouped by day/week/month with totals', 'g-1.9', '1.9.7'),
  t('t-1.9.8',  'Transaction report',           'All wallet transactions across platform with filters', 'g-1.9', '1.9.8'),
  t('t-1.9.9',  'Top astrologers report',       'Ranked by earnings/consultations/rating', 'g-1.9', '1.9.9'),
  t('t-1.9.10', 'Gift CRUD',                    'Create/update/delete gifts, view gift transaction history', 'g-1.9', '1.9.10'),
  t('t-1.9.11', 'Recharge slab CRUD',           'Create/update/delete recharge options with bonus', 'g-1.9', '1.9.11'),
  t('t-1.9.12', 'Chat keyword CRUD',            'Add/update/delete moderation keywords (exact + regex)', 'g-1.9', '1.9.12'),
  t('t-1.9.13', 'Review moderation',            'List/delete reviews, recalculate astrologer stats on delete', 'g-1.9', '1.9.13'),
  t('t-1.9.14', 'System config',                'Get/update global settings (commission, free session, timeouts)', 'g-1.9', '1.9.14'),

  // ── MOBILE — USER APP ────────────────────────────────────────────
  t('g-2',      'MOBILE — USER APP',            '',    null,   '2'),

  t('g-2.0',    'Wallet',                       '',    'g-2',  '2.0'),
  t('t-2.0.1',  'Wallet screen',                'Show balance, transaction history, recharge button', 'g-2.0', '2.0.1'),
  t('t-2.0.2',  'Recharge flow',                'Slab selection, Razorpay checkout, success/failure handling', 'g-2.0', '2.0.2'),
  t('t-2.0.3',  'Low balance prompt',           'Show recharge prompt when balance insufficient for consultation', 'g-2.0', '2.0.3'),

  t('g-2.1',    'Astrologer Discovery',         '',    'g-2',  '2.1'),
  t('t-2.1.1',  'Astrologer listing',           'Grid/list view with filters (language, specialization, rating, online, type)', 'g-2.1', '2.1.1'),
  t('t-2.1.2',  'Astrologer profile',           'Full profile — bio, gallery, rates, reviews, schedule, follow button', 'g-2.1', '2.1.2'),
  t('t-2.1.3',  'Similar astrologers',          'Show recommendations when preferred astrologer unavailable', 'g-2.1', '2.1.3'),
  t('t-2.1.4',  'Search',                       'Search by name, specialization', 'g-2.1', '2.1.4'),

  t('g-2.2',    'Consultation Flow',            '',    'g-2',  '2.2'),
  t('t-2.2.1',  'Intake form',                  'Pre-consultation birth details form, prefill from profile', 'g-2.2', '2.2.1'),
  t('t-2.2.2',  'Request chat',                 'Tap chat button → balance check → create request → waiting screen', 'g-2.2', '2.2.2'),
  t('t-2.2.3',  'Request call (audio/video)',   'Tap call button → balance check → create request → waiting screen', 'g-2.2', '2.2.3'),
  t('t-2.2.4',  'Waiting screen',               'Poll status, show timer, cancel button, handle accept/reject/timeout', 'g-2.2', '2.2.4'),
  t('t-2.2.5',  'Chat screen',                  'CometChat SDK integration, real-time messaging, media send, gift button', 'g-2.2', '2.2.5'),
  t('t-2.2.6',  'Call screen (audio)',           'Agora SDK, audio-only UI, mute/speaker/end buttons, duration timer', 'g-2.2', '2.2.6'),
  t('t-2.2.7',  'Call screen (video)',           'Agora SDK, video UI with local/remote views, camera flip, mute, end', 'g-2.2', '2.2.7'),
  t('t-2.2.8',  'End session',                  'End button → billing summary popup', 'g-2.2', '2.2.8'),
  t('t-2.2.9',  'Consultation history',         'List of past consultations with details', 'g-2.2', '2.2.9'),

  // ── MOBILE — ASTROLOGER APP ──────────────────────────────────────
  t('g-3',      'MOBILE — ASTROLOGER APP',      '',    null,   '3'),

  t('g-3.0',    'Onboarding',                   '',    'g-3',  '3.0'),
  t('t-3.0.1',  'Registration flow',            'Phone OTP → profile form (name, bio, experience, languages, specializations)', 'g-3.0', '3.0.1'),
  t('t-3.0.2',  'Pending verification screen',  'Show "awaiting admin verification" state', 'g-3.0', '3.0.2'),
  t('t-3.0.3',  'Banking details',              'Add/edit bank account, UPI, PAN, Aadhaar', 'g-3.0', '3.0.3'),

  t('g-3.1',    'Profile & Settings',           '',    'g-3',  '3.1'),
  t('t-3.1.1',  'Profile management',           'Edit profile, upload photo, manage gallery', 'g-3.1', '3.1.1'),
  t('t-3.1.2',  'Rate management',              'Set/edit chat, audio, video rates + emergency rates + discounts', 'g-3.1', '3.1.2'),
  t('t-3.1.3',  'Availability toggle',          'Online/offline switch with confirmation', 'g-3.1', '3.1.3'),
  t('t-3.1.4',  'Weekly schedule',              'Set time slots per day of week', 'g-3.1', '3.1.4'),
  t('t-3.1.5',  'Assistant management',         'Add/remove assistants, set permissions', 'g-3.1', '3.1.5'),

  // ── ADMIN WEB ────────────────────────────────────────────────────
  t('g-4',      'ADMIN WEB',                    '',    null,   '4'),

  t('g-4.0',    'Astrologer Management',        '',    'g-4',  '4.0'),
  t('t-4.0.1',  'Astrologer list',              'Table with filters (verification status, availability, search)', 'g-4.0', '4.0.1'),
  t('t-4.0.2',  'Astrologer detail',            'Full profile view with unmasked banking, stats, recent activity', 'g-4.0', '4.0.2'),
  t('t-4.0.3',  'Verify/reject',                'Approve or reject pending astrologer with reason', 'g-4.0', '4.0.3'),
  t('t-4.0.4',  'Activate/deactivate',          'Force astrologer offline, disable account', 'g-4.0', '4.0.4'),
  t('t-4.0.5',  'Edit astrologer',              'Update profile, rates, emergency settings from admin', 'g-4.0', '4.0.5'),
];

// ensure prds/slug dir exists
const dir = path.join(__dirname, '..', 'prds', slug);
if (!fs.existsSync(dir)) {
  console.error(`Project "${slug}" not found at ${dir}`);
  process.exit(1);
}

fs.writeFileSync(outPath, JSON.stringify(tasks, null, 2));
console.log(`✓ Written ${tasks.length} tasks to ${outPath}`);
