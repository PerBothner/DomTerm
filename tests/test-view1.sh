# Test view-mode key sequences

. ./test-defs.sh
if test "$1" = '--write-text1'
then
cat <<EOF
GARMAN AND WORSE, CHAPTER I. Alexander Kielland, translated by W. W. Kettlewell

    Nothing is so boundless as the sea, nothing so patient. On its broad back it bears, like a good-natured elephant, the tiny mannikins which tread the earth; and in its vast cool depths it has place for all mortal woes.
It is not true that the sea is faithless, for it has never promised anything; without claim, without obligation, free, pure, and genuine beats the mighty heart, the last sound one in an ailing world. And while the mannikins strain their eyes over it, the sea sings its old song.
Many understand it scarce at all, but never two understand it in the same manner, for the sea has a distinct word for each one that sets himself face to face with it.

    It smiles with green shining ripples to the bare-legged urchin who catches crabs; it breaks in blue billows against the ship, and sends the fresh salt spray far in over the deck.
Heavy leaden seas come rolling in on the beach, and while the weary eye follows the long hoary breakers, the stripes of foam wash up in sparkling curves over the even sand; and in the hollow sound, when the billows roll over for the last time, there is something of a hidden understanding—each thinks on his own life, and bows his head towards the ocean as if it were a friend who knows it all and keeps it fast.
EOF
exit
fi

set -e
${TNEWDOMTERM}
${TDOMTERM} -w 1 await --match-output '1[$]' ''
${TSEND_INPUT} 'echo -e "\\e[8;24;60t"\r'
${TSEND_INPUT} 'sh '$0' --write-text1\r'
${TDOMTERM} -w 1 await --match-output '3[$$]' ''
${TDOKEYS} Ctrl+Shift+M
${TDOKEYS} 2 Up 4 Right Shift+Home
test "$(${TCAPTURE} -S)" = "on his"
${TDOKEYS} 2 Up 2 Shift+Ctrl+Right
test "$(${TCAPTURE} -S)" = "he hollow"
${TDOKEYS} Up Home 3 Shift+Ctrl+Right
test "$(${TCAPTURE} -S)" = "foam wash up"
${TDOKEYS} Alt+Up 5 Shift+Right
test "$(${TCAPTURE} -S)" = "d sen"
${TDOKEYS} Home 2 Shift+Ctrl+Right 'Ctrl+!'
test "$(${TCAPTURE} -S)" = "the ship"
${TDOKEYS} Home 2 Shift+Ctrl+Right 'Ctrl+!'
test "$(${TCAPTURE} -S)" = "It smiles"
${TDOKEYS} Home Shift+End
test "$(${TCAPTURE} -S)" = "    It smiles with green shining ripples to the bare-legged "
${TDOKEYS} End Shift+Home
test "$(${TCAPTURE} -S)" = "k."
${TDOKEYS} Ctrl+Shift+M
${SEND_INPUT} -w 1 -C 'exit\r'
echo test-view1 OK
