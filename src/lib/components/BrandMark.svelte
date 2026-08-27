<script lang="ts">
  // The Anomalia logo mark — sits next to the "Anomalia" wordmark in the navbar, footer and
  // app sidebar. Inline SVG so it scales crisply and ships with no extra request. Keeps its
  // brand colour (#9D86FF = --accent-2), which reads on both the light marketing chrome and
  // the app sidebar.
  let { size = 24 }: { size?: number } = $props();
</script>

<svg
  class="brandmark"
  width={size}
  height={size}
  viewBox="0 0 947 464"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <defs>
    <linearGradient id="brandmark-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:var(--accent);stop-opacity:1" />
      <stop offset="100%" style="stop-color:var(--accent-2);stop-opacity:1" />
    </linearGradient>
  </defs>
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M473.158 226.577C473.158 226.577 390.618 226.577 365.909 226.577C341.199 226.577 314.629 213.958 327.005 169.75C342.293 115.155 415.443 78.2267 473.158 78.2267C530.873 78.2267 604.023 115.155 619.311 169.75C631.697 213.958 605.116 226.577 580.407 226.577C555.698 226.577 473.158 226.577 473.158 226.577ZM49.0507 231.406C32.6058 231.301 16.1084 230.999 0 230.999V231.406V240.896V254.13H946.316V240.906V231.395V230.988C930.207 230.988 913.71 231.291 897.265 231.395H879.401C847.026 231.155 815.472 229.361 788.113 221.999C722.512 204.343 714.878 171.106 681.852 123.759C643.358 68.6113 577.505 0 473.158 0C368.811 0 302.958 68.6009 264.464 123.769C231.437 171.106 223.804 204.343 158.203 222.009C130.844 229.372 99.2896 231.166 66.915 231.406H49.0507ZM617.355 281.693H682.388C682.388 324.848 632.517 464 473.158 464C313.798 464 263.927 324.848 263.927 281.693H328.96C328.96 308.777 363.333 402.418 473.158 402.418C582.983 402.418 617.355 308.777 617.355 281.693Z"
    fill="url(#brandmark-gradient)"
  />
</svg>

<style>
  .brandmark {
    display: block;
    flex: none;
  }
</style>
