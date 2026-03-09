export const IconMail = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z" />
        <path d="M3 7l9 6l9 -6" />
    </svg>
);

export const IconLock = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
        <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
        <path d="M8 11v-4a4 4 0 1 1 8 0v4" />
    </svg>
);

const base = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    strokeWidth: 1.8,
    stroke: 'currentColor',
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
};

export const IconSettings = (props) => (
    <svg {...base} {...props}>
        <path d="M12 3l1.3 2.6l2.9 .4l-2.1 2.1l.5 3l-2.6-1.4l-2.6 1.4l.5-3l-2.1-2.1l2.9-.4z" />
        <circle cx="12" cy="12" r="3.2" />
    </svg>
);

export const IconSync = (props) => (
    <svg {...base} {...props}>
        <path d="M20 5v5h-5" />
        <path d="M4 19v-5h5" />
        <path d="M5.6 15A7 7 0 0 0 18 17" />
        <path d="M18.4 9A7 7 0 0 0 6 7" />
    </svg>
);

export const IconDisplay = (props) => (
    <svg {...base} {...props}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8" />
        <path d="M12 16v4" />
    </svg>
);

export const IconUser = (props) => (
    <svg {...base} {...props}>
        <circle cx="12" cy="8" r="4" />
        <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
);

export const IconCopy = (props) => (
    <svg {...base} {...props}>
        <rect x="9" y="9" width="10" height="10" rx="2" />
        <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
);

export const IconPin = (props) => (
    <svg {...base} {...props}>
        <path d="M12 17v4" />
        <path d="M8 3l8 8" />
        <path d="M15 2l7 7l-3 1l-4 4l-1 3l-7-7l3-1l4-4z" />
    </svg>
);

export const IconCloud = (props) => (
    <svg {...base} {...props}>
        <path d="M6 18a4 4 0 0 1 .7-8A5.5 5.5 0 0 1 17 8.8A3.5 3.5 0 1 1 18 18z" />
    </svg>
);

export const IconChevron = (props) => (
    <svg {...base} {...props}>
        <path d="M6 9l6 6l6-6" />
    </svg>
);
