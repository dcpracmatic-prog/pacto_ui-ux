export function PactoLogo({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Protocolo PACTO — Dos manos resguardando el interés superior del menor"
    >
      {/* Left protective hand curve */}
      <path
        d="M6.5 18.5C6.5 12.2 11.4 8 15.8 10.6C16.8 11.2 17.5 12.1 18 13.1"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M6.5 18.5C6.5 23.8 12.3 27.6 18 30.5"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* Right protective hand curve */}
      <path
        d="M29.5 18.5C29.5 12.2 24.6 8 20.2 10.6C19.2 11.2 18.5 12.1 18 13.1"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M29.5 18.5C29.5 23.8 23.7 27.6 18 30.5"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* Inner heart representing the child (ISM) */}
      <path
        d="M18 22.8C18 22.8 13.2 19.8 13.2 16.7C13.2 15.1 14.4 13.9 15.9 13.9C16.8 13.9 17.5 14.4 18 15.1C18.5 14.4 19.2 13.9 20.1 13.9C21.6 13.9 22.8 15.1 22.8 16.7C22.8 19.8 18 22.8 18 22.8Z"
        fill="#B91C1C"
      />
    </svg>
  );
}
