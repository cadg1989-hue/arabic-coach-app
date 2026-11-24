// Lets learners "Add to Home Screen" so the app opens like a normal phone app.
export default function manifest() {
  return {
    name: "Arabic Coach: Saudi Arabic for work",
    short_name: "Arabic Coach",
    start_url: "/",
    display: "standalone",
    background_color: "#0f2a24",
    theme_color: "#0f2a24",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
