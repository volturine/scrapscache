// Load-bearing: the Panda postcss plugin processes the layered styled-system
// CSS that app.css pulls in. Without it, Vite's default pipeline silently drops
// most @layer blocks from the production bundle (see the e2e theme and
// reminder tests, which catch exactly that). Do not remove.
module.exports = {
	plugins: {
		'@pandacss/dev/postcss': {}
	}
};
