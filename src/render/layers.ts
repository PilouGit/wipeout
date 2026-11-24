/**
 * Calque de rendu du ciel : il est dessiné à part, en basse définition, dans une texture qui sert
 * de fond à la scène (nuages et plasmas sont des formes douces : la demi-résolution ne se voit pas,
 * et c'était le shader le plus coûteux de l'image).
 */
export const SKY_LAYER = 1;
