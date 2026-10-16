# People resolution, phase 1 (data only)

Output of `python scripts/resolve_people.py --sample`. Nothing here is applied to the app: it is a
layer of *persons* over the name keys, plus proposals for the community to accept or reject.

- `persons.json` — one entry per person: stable `id`, the name `key` it came from, display `name`
  (most frequent spelling), `variants`, `records`, `span`, `born` = [year, evidence ids, established]
  (established = two stated ages agree; a single "de N años" is often someone else's age in the deed),
  `dead_by`, `spouse`/`parents`/`children`/`siblings`/`residence` with evidence ids, `titles`,
  `split_from` (how many persons the key became). `unresolvable: "given name only"` marks keys like
  *maría* or *juan francisco* that no amount of arithmetic can separate.
- `proposals.jsonl` — `split` proposals (one per key that became several persons, with the lives and
  the conflicts that separated them) and `merge` proposals between persons of different keys:
  `kind: spelling` (identical once particles, abbreviations and titles are normalized) or `similar`
  (Jaro-Winkler ≥ 0.82 or a subset name), with `confidence` and `reasons`.
- `scorecard.json` — before/after metrics.

## Scorecard

- name_keys: 20341
- persons: 21437
- keys_split: 949
- persons_from_splits: 2045
- unresolvable_given_name_keys: 1412
- records_in_unresolvable_keys: 7164
- keys_span_over_85y_before: 1079
- persons_span_over_85y_after: 0
- split_conflicts: {'death': 407, 'lifespan': 5038, 'birth': 45, 'clergy': 187}
- splits_with_arbitrary_boundary: 131
- birth_hints_in_people_json: 3070
- birth_hints_trusted: 298
- dead_hints_in_people_json: 8278
- dead_hints_trusted: 1694
- merge_proposals: 7348
- merge_proposals_spelling: 2008
- merge_proposals_sure: 2077
- single_record_keys_before: 12376
- single_record_persons_after_split: 13035
- single_record_persons_after_sure_merges: 11502

## What the scorecard says

- Of the 3 070 "born" hints in people.json only 298 pass the adjacency test (age stated right after the person's own name); the rest are mostly the age of a slave or child in the same deed. Of 8 278 "dead" hints, 1 694 name the person as the dead one. Both regexes in `build_people.py` need the same rule before the profile pages keep showing them.
- Lifespan is the dominant split reason: 5 000+ mentions could not belong to the life they followed. Where that is the *only* reason and the lives touch, the boundary is marked `arbitrary`: the key holds a father and a son (or three generations) and only a reader or a model with the summaries can place the cut.
- `spelling` merges (same name once particles, abbreviations and titles are normalized, lives compatible) are safe to accept in bulk; `similar` ones at 0.5–0.75 are subset names with compatible years and need a reader.
- Given-name-only keys (*maría*, *juan francisco*) hold 7 164 record mentions and are left whole and flagged.

## Sample (10 largest splits, 10 random; 10 surest merges, 10 random under 0.75)

```
=== SPLITS (10 largest, 10 random) ===

pedro de alvarado  (842 records → 5 persons; conflicts {'lifespan': 197, 'birth': 1}; boundary evidence)
  - Pb7c07a35 Pedro de Alvarado  [1520, 1570]  n=733  cónyuge: pedro  {'military': 450, 'don': 1}
      #200006: En el mismo día de la fundación, Pedro de Alvarado, teniente gobernador y capitán general en nombre de Hernán Cortés, nombra los primeros of
  - Pb8340fcd Pedro de Alvarado  [1615, 1700]  n=42  cónyuge: bernabe de segura  {'don': 20, 'military': 2}
      #2014: El Alcalde Alonso de Bonilla concertó un aprendizaje para Diego de Sojo, hijo de Alonso de Sojo y Ana de Arrieta, con Pedro de Alvarado, un 
  - P0a725a76 Pedro de Alvarado  [1701, 1782]  n=49  cónyuge: josefa gonzalez  {'don': 23, 'military': 3}
      #2427: Antonio de Acosta Arévalo vendió una plantación de cacao de 2000 árboles ubicada en la orilla del río Matina, en la costa del Mar del Norte,
  - P8a6e7824 Don Pedro de Alvarado  [1719, 1804]  n=14  nac≈1714  {'military': 1, 'don': 9, 'clergy': 1}
      #3241: Don Pedro Ortiz de Rosas proporcionó una dote de $5375 y arras de $2000 para su futura esposa, Doña Juana de Alvarado Vera y Sotomayor, hija
  - P916acd2a Presbítero Don Pedro de Alvarado  [1807, 1819]  n=4  {'don': 1, 'clergy': 3}
      #10239: Doña Ana Jacoba de Alvarado, viuda de Don Francisco Carazo, hace su testamento, enumerando a sus padres, esposo difunto, doce hijos vivos y 

jorge de alvarado  (236 records → 4 persons; conflicts {'lifespan': 69}; boundary arbitrary)
  - P99ae5f7e Jorge de Alvarado (teniente de gobernador)  [1520, 1541]  n=186  {'military': 169}
      #200021: Continuación del acta de elección anual de oficios: Pedro de Alvarado, en nombre de Su Majestad y del gobernador, nombra alcaldes ordinarios
  - Pc1240e47 Jorge de Alvarado  [1623, 1705]  n=35  {'don': 20, 'military': 2}
      #2105: Se emitió una carta de dote para Jorge de Alvarado, hijo de Gil de Alvarado y Juana de Vera, y su esposa Gertrudis de Sandoval, hija de Juan
  - P6e1ee2ce Jorge de Alvarado  [1709, 1727]  n=11  {'don': 2, 'military': 2}
      #3445: Don Pedro de Alvarado, hijo del difunto Alférez Gil de Alvarado y Juana de Vera y Sotomayor, hizo su testamento. Estaba casado con Catalina 
  - Pf2b58801 Don Jorge de Alvarado  [1798, 1798]  n=4  {'don': 3}
      #3261: Los Capitanes Don Matías González Camino, Don José Pérez de Muro, Diego de San Martín y Soto, y Don Jorge de Alvarado actuaron como fiadores

antonio de la fuente  (166 records → 2 persons; conflicts {'lifespan': 7}; boundary arbitrary)
  - Pa4a2f6a8 Don Antonio de la Fuente  [1721, 1804]  n=159  cónyuge: antonia, jose maria paz, maria de jesus salazar  {'don': 108, 'military': 3}
      #7621: Se emitió una carta de dote por Don Antonio de la Fuente, natural de Astorga en los reinos de Castilla, hijo de Don Ignacio de la Fuente y D
  - P51da9b14 Don Antonio de la Fuente  [1807, 1831]  n=7  {'don': 4, 'military': 1}
      #7917: Don Antonio de la Fuente, actuando como apoderado de Don Juan Garau de Cort, vendió a la mujer esclavizada de 27 años, María Ramona Guerrero

juan de echavarria navarro  (138 records → 3 persons; conflicts {'birth': 1, 'death': 18, 'lifespan': 14}; boundary evidence)
  - P0680f4e8 Juan de Echavarría Navarro  [1615, 1700]  n=31  cónyuge: antonia maria de otalora  {'military': 9, 'don': 1}
      #164: Luisa Hernández, viuda de Capitán Juan de Lamas, recibió 200 pesos de Padre Baltasar de Grado con una tasa de interés anual del 5%. Hipotecó
  - P4a273cc2 Juan de Echavarría Navarro  [1638, 1688]  n=93  nac≈1622  cónyuge: ana de retes, francisco ramiro  {'don': 27}
      #479: Doña María de Sandoval, viuda del Tesorero Juan de Echavarría Navarro, otorgó poder a los procuradores Francisco de Castro y Miguel de Artav
  - P8284bb37 Juan de Echavarría Navarro  [1701, 1719]  n=14  cónyuge: ana, ana de retes, tesorero fernando de salazar  {'military': 6, 'don': 1}
      #1742: Ambrosia de Echavarría Navarro hizo su testamento. Era hija legítima de Juan de Echavarría Navarro, ex tesorero provincial, y María de Sando

miguel calvo  (133 records → 3 persons; conflicts {'lifespan': 99}; boundary arbitrary)
  - P236188c4 Miguel Calvo  [1608, 1693]  n=36  cónyuge: alonso de bonilla, ana micaela calvo, gaspar de chinchilla  {'military': 11}
      #59: Miguel Calvo vendió a un hombre negro esclavizado llamado Juan, de Angola, a Gaspar Pereira Cardoso, Alguacil Mayor de la Gobernación, por 3
  - Pead44041 Capitán don Miguel Calvo  [1694, 1773]  n=95  {'military': 54, 'don': 4}
      #2619: El Capitán Juan Rodríguez Plaza y su esposa Juana de Salazar se obligaron por $300 a una Capellanía fundada por el Capitán Matías González C
  - P2ef8243b Capitán don Miguel Calvo  [1798, 1798]  n=2  {'military': 2}
      #3243: El Capitán Antonio de Rojas Miranda, como principal, y el Alférez Diego de Cárdenas, como garante, se comprometieron con el Capitán don Migu

gil de alvarado  (129 records → 2 persons; conflicts {'lifespan': 48}; boundary arbitrary)
  - Pbee604d2 Gil de Alvarado  [1629, 1712]  n=81  cónyuge: antonio, bartolome arias  {'don': 32, 'military': 16}
      #106: Andrés Morillo se obligó con el Capitán General Juan de Echauz, Gobernador de la provincia, por 200 pesos. Este dinero fue prestado para can
  - P28249ee9 Gil de Alvarado  [1715, 1756]  n=48  cónyuge: manuela petronila lopez  {'don': 21, 'military': 12}
      #4037: Don Gil de Alvarado y su esposa, doña Josefa González Camino, vendieron una parte de una casa de adobe con tejas, que le fue dada como dote,

antonio de salazar  (125 records → 3 persons; conflicts {'lifespan': 3}; boundary evidence)
  - Pb5eca8da Antonio de Salazar (regidor)  [1527, 1530]  n=123  
      #200084: Antonio de Salazar declara que el asiento del Tianguecillo es bueno, con aguas, salidas y aspecto sano, pero cree que faltará yerba para cab
  - Pd418b063 Antonio de Salazar  [1617, 1617]  n=1  
      #100258: Conclusión de una sesión en la que se debate sobre la nulidad de un acuerdo por falta de cabildo pleno y se anota que no hubo apelación. Fir
  - P38a66893 Antonio de Salazar  [1709, 1709]  n=1  
      #3888: El Sargento Mayor Francisco de Ocampo Golfín, Alcalde Ordinario Mayor, concertó un aprendizaje de cinco años para Antonio de Salazar, un niñ

tomas lopez del corral  (125 records → 3 persons; conflicts {'death': 69, 'lifespan': 54}; boundary evidence)
  - P8557c176 don Tomás López del Corral  [1673, 1673]  n=3  {'don': 3}
      #8004: Don Tomás López del Corral y Pedro Manuel Salguero otorgaron una fianza para Don Juan Fernández de Bobadilla y Grandi, quien fue nombrado Go
  - P6d594a8a Capitán don Tomás López del Corral  [1718, 1802]  n=121  cónyuge: gregorio de la calle, jacinto quiros, maria lopez  {'don': 42, 'military': 53}
      #5235: El Capitán don Tomás López del Corral, Teniente de Oficiales de la Real Hacienda, canceló la obligación el 20 de septiembre de 1730.
  - P99239435 Don Tomás López del Corral  [1808, 1808]  n=1  {'don': 1}
      #8014: Don Tomás López del Corral y Don Julián de Azofeifa presentaron un documento al Gobernador, retirando una denuncia penal interpuesta por Lóp

tomas calvo  (121 records → 3 persons; conflicts {'lifespan': 130}; boundary arbitrary)
  - P48c23575 Tomás Calvo  [1540, 1625]  n=10  {'military': 2}
      #216: Andrés de Miranda, hijo legítimo de Martín de Miranda e Inés Hidalgo, residentes de León, entregó un recibo de dote (falta una página). Entr
  - P84b4428b Tomás Calvo  [1626, 1711]  n=92  cónyuge: depositario tomas calvo, jose maroto, juan de olivares  {'military': 23}
      #543: El Alférez Tomás Calvo emitió una carta de dote para su esposa, Eugenia Abarca, hija del Alférez Gaspar Abarca de Latras y Magdalena de Chav
  - Pe1ef2fd7 Tomás Calvo  [1715, 1786]  n=19  {'don': 1, 'military': 4}
      #4073: Doña Magdalena Calvo, hija de los difuntos Tomás Calvo y Doña Eugenia de Abarca Alatras y viuda del Capitán Francisco Fernández de Miranda, 

francisco de ocampo golfin  (113 records → 3 persons; conflicts {'death': 18, 'lifespan': 71}; boundary evidence)
  - P915a4bec Francisco de Ocampo Golfín  [1607, 1640]  n=29  cónyuge: jeronimo de la portilla, juan de sanabria maldonado  {'military': 8, 'don': 2}
      #1: El Capitán Francisco de Ocampo Golfín, encomendero de Cartago, otorgó poder general a Gómez Arias. Gómez Arias era procurador legal en la Au
  - Pfa8be13e Francisco de Ocampo Golfín  [1675, 1754]  n=79  cónyuge: felipe gomez macotela, juan fernandez de la fuente, juan garcia de adan  {'don': 7, 'military': 8}
      #1522: Alonso de Mora y Leonor de Rivera se obligaron con la Capellanía fundada por Vasco Solano por $1,000, hipotecando el rancho San Bartolomé. E
  - P870a6620 Don Francisco de Ocampo Golfín  [1770, 1800]  n=5  {'military': 1, 'don': 2}
      #3264: El Capitán Francisco de Bonilla, el Alférez Nicolás de Céspedes, el Capitán Francisco de Ocampo Golfín, el Capitán Don Miguel Calvo y el Alf

juan calvo  (18 records → 2 persons; conflicts {'lifespan': 6}; boundary evidence)
  - P86e61bca Juan Calvo  [1658, 1738]  n=12  {'military': 2}
      #1866: El Capitán Juan de Salamanca y Alarcón, residente de Cartago, otorgó poder a don José de Alvarado y Juan Martínez de Ahumada, quienes partía
  - P035bd91a Juan Calvo  [1754, 1809]  n=6  
      #7209: El Presbítero Bachiller José Manuel García de Argueta se obligó por 200 pesos a una capellanía fundada por Luisa Calvo, de la cual él es el 

isidora zambrano  (16 records → 2 persons; conflicts {'lifespan': 14}; boundary evidence)
  - Pb982d106 Isidora Zambrano  [1540, 1540]  n=2  
      #1309: El Capitán Rodrigo Calderón y su esposa Isidora Zambrano se obligaron por $100 a un censo del 5% al fondo de dotes para doncellas de la Cofr
  - Pfb9d36ac Isidora Zambrano  [1630, 1710]  n=14  cónyuge: manuel martinez, rodrigo calderon  {'don': 3}
      #630: Se emite una carta de dote para Manuel Martínez, natural de Valencia, Castilla la Vieja, a favor de su esposa Isidora Zambrano. La dote, val

gabriel rodriguez  (4 records → 2 persons; conflicts {'lifespan': 2}; boundary evidence)
  - P1d6fe1dc Gabriel Rodríguez  [1683, 1726]  n=2  
      #2372: Gabriel Rodríguez, natural de Ayamonte, España, hijo de los difuntos Miguel Rodríguez y Ana Rodríguez, hizo su testamento. El Capitán Juan L
  - P54f96c80 Don Gabriel Rodríguez  [1807, 1818]  n=2  {'don': 1}
      #10244: El 26 de agosto, un testamento hecho el 24 de junio por Don Mariano Rodríguez y Doña Ana Sancho fue protocolizado ante el Alcalde 1° Don Jos

sebastian de quesada  (8 records → 2 persons; conflicts {'lifespan': 7}; boundary evidence)
  - Pfee90204 Sebastián de Quesada (maestre)  [1564, 1564]  n=1  
      #300024: Contrato de pasaje otorgado en Sevilla en la nao El Ángel Bueno: Francisco Dorado fleta pasaje a San Juan de Ulía para 1 adulto a 22 ducados
  - P1fbc9f52 Sebastián de Quesada  [1732, 1754]  n=7  cónyuge: mata  
      #5868: Rosa Leitón, la viuda de Mata, vendió un cacaotal ubicado en Matina al Alférez Sebastián de Quesada. La venta se concluyó por un precio de 1

magdalena de la portilla  (25 records → 2 persons; conflicts {'lifespan': 10}; boundary arbitrary)
  - P71e08738 Magdalena de la Portilla  [1629, 1711]  n=15  
      #96: Magdalena de la Portilla, viuda del Capitán Pedro de Arce, otorgó poder general a Francisco de Arrieta.
  - P977557e2 Magdalena de la Portilla  [1719, 1740]  n=10  
      #4057: El Capitán Tomás Andrés Polo y su esposa, Doña Josefa López de la Flor, se comprometieron a pagar 300 pesos a la capellanía fundada por Magd

francisco de chaves  (59 records → 4 persons; conflicts {'lifespan': 76}; boundary arbitrary)
  - P62e6df31 Francisco de Chaves  [1524, 1524]  n=1  
      #200016: Nómina de vecinos y pobladores de la ciudad, sin fecha ni encabezado propio en esta página; continúa la lista de nombres que venía de la pág
  - P713d4ee6 Francisco de Chaves  [1623, 1703]  n=41  cónyuge: cristobal de chaves  {'military': 5, 'don': 1}
      #124: El 29 de diciembre, se registró el testamento cerrado de María de Alfaro, viuda de Cristóbal de Chaves. Nombró a sus ocho hijos, incluyendo 
  - P315c7696 Francisco de Chaves  [1711, 1747]  n=16  {'military': 4}
      #4154: Don Antonio de Utrera y Medina y Doña Josefa de Moya contrajeron una obligación de 300 pesos con los herederos de Francisco de Chaves, un co
  - P143ad94c Francisco de Chaves  [1798, 1798]  n=1  
      #3253: Esta entrada menciona el testamento del Capitán Don Gregorio de Chaves, hijo legítimo de los difuntos Francisco de Chaves y Doña Francisca d

antonio de soto y barahona  (71 records → 2 persons; conflicts {'lifespan': 1}; boundary evidence)
  - Pd967b72a Capitán Antonio de Soto y Barahona  [1702, 1785]  n=70  cónyuge: juana maria de soto, mayor antonio de soto  {'military': 35, 'don': 4}
      #3606: Antonio de Soto y Barahona proporciona una dote para su prometida doña Petronila de Hoces Navarro. Petronila es la hija legítima del Alférez
  - Pd4cfe89b Don Antonio de Soto y Barahona  [1802, 1802]  n=1  {'don': 1}
      #9899: Doña Manuela Fernández de la Pastora, arrendataria de una capellanía fundada en 1731 por Don Antonio de Soto y Barahona, reconoció al Presbí

francisca hernandez  (5 records → 2 persons; conflicts {'lifespan': 2}; boundary evidence)
  - Pd4fe89b6 Francisca Hernández  [1623, 1673]  n=3  cónyuge: juan de vargas  
      #219: Esta entrada detalla el testamento de Catalina Martín, hija natural del Alférez Juan de Acuña y Francisca Hernández, y viuda de Juan de Varg
  - Pe1f24d51 Francisca Hernández  [1733, 1733]  n=2  
      #6032: El Capitán Nicolás Estrada y su esposa, Lorenza Muñoz Hidalgo, se comprometieron a una capellanía establecida por los difuntos Alférez Diego

juan murillo  (4 records → 2 persons; conflicts {'lifespan': 1}; boundary evidence)
  - P79c83244 Juan Murillo  [1676, 1737]  n=3  
      #2160: Juan y Salvador Murillo, junto con sus hermanas Isabel y Lucía, herederos de los difuntos Alférez Andrés Murillo de Campos y Magdalena de Gu
  - Pf565ef04 Juan Murillo  [1818, 1818]  n=1  
      #10347: Pedro Soto se obligó con sus nietas, Ciriaca y María Manuela Murillo, por 70 pesos 2 reales de su herencia. Su madre, Manuela Soto, perdió l

cayetano munoz  (25 records → 2 persons; conflicts {'death': 1}; boundary evidence)
  - Pd2438d10 Capitán Cayetano Muñoz  [1716, 1751]  n=24  cónyuge: manuel jose gomez  {'military': 18, 'don': 1}
      #4459: Capitán Francisco Gutiérrez hace su testamento, detallando su familia, bienes y deudas. Fue viudo de Nicolasa de Flores, con quien tuvo cinc
  - P4208c99b Don Cayetano Muñoz  [1786, 1786]  n=1  {'don': 1}
      #8140: El 26 de marzo, Doña Clemencia Muñoz hizo su testamento, identificando a sus padres difuntos, a su esposo Don Félix García y Ergueta, y a su

=== MERGES (10 surest, 10 random ≥0.5) ===

0.99 spelling Francisco de Ocampo Golfín  ↔  Frco. de Ocampo Golfín
      nombre 1.00 · mismo cónyuge: jeronimo de la portilla · años 1607–1640 y 1632–1639

0.99 spelling Nicolás de Figueroa  ↔  Nicolás Figueroa
      nombre 1.00 · mismos padres: adriano de figueroa · nacimiento ≈1655 / ≈1655 · años 1656–1671 y 1671–1671

0.99 spelling Doña María Francisca de Alvarado  ↔  Doña María Francisca Alvarado
      nombre 1.00 · mismo cónyuge: antonio de la fuente · años 1765–1816 y 1792–1808

0.99 spelling Doña Antonia María Venegas  ↔  Antonia María de Venegas
      nombre 1.00 · mismo cónyuge: bernardo sarmiento de sotomayor · años 1681–1742 y 1698–1698

0.99 similar  Doña Francisca del Castillo  ↔  Francisca del Castillo (daughter)
      nombre 0.90 · mismo cónyuge: juana de la cruz, rodrigo de cabrera · mismos padres: felipe monje, francisca lopez · años 1654–1715 y 1655–1655

0.99 spelling Magdalena de Sosa  ↔  Magdalena Sosa
      nombre 1.00 · mismo cónyuge: jose de amores · años 1720–1743 y 1743–1743

0.99 spelling Josefa de Santiago y Aguilar  ↔  Doña Josefa Santiago de Aguilar
      nombre 1.00 · mismo cónyuge: antonio de acosta arevalo · años 1678–1735 y 1695–1735

0.99 spelling Josefa de Santiago y Aguilar  ↔  Doña Josefa de Aguilar y Santiago
      nombre 1.00 · mismo cónyuge: antonio de acosta arevalo · mismos padres: antonio de acosta arevalo · años 1678–1735 y 1684–1753

0.99 spelling Doña Josefa Santiago de Aguilar  ↔  Doña Josefa de Aguilar y Santiago
      nombre 1.00 · mismo cónyuge: antonio de acosta arevalo · años 1695–1735 y 1684–1753

0.99 similar  Miguel de Acosta Arévalo  ↔  Miguel de Acosta
      nombre 0.90 · mismo cónyuge: antonio de acosta arevalo · mismos padres: josefa de aguilar · años 1698–1725 y 1705–1741

0.62 similar  Francisco de Oviedo  ↔  Francisco Alvarez de Oviedo
      nombre 0.90 · años 1719–1723 y 1702–1726

0.55 similar  Don José Miguel de Mier Cevallos  ↔  José Cevallos
      nombre 0.90 · años 1732–1746 y 1750–1750 (sin solape)

0.62 similar  José González  ↔  José Isidro González
      nombre 0.90 · años 1740–1818 y 1788–1788

0.62 similar  Don Bartolomé García de Miranda  ↔  Don Bartolomé García Miranda y Casasola
      nombre 0.90 · años 1763–1778 y 1778–1778

0.62 similar  Josefa Fernández  ↔  Josefa Fernández Solano
      nombre 0.90 · años 1687–1751 y 1714–1721

0.57 similar  doña Ramona Petronila de Ibarra  ↔  Ramona de Ibarra
      nombre 0.90 · años 1746–1746 y 1747–1783 (sin solape)

0.57 similar  Sargento Mayor don Julián García  ↔  Sargento Mayor don Julián García de Hergueta
      nombre 0.90 · años 1739–1739 y 1740–1743 (sin solape)

0.62 similar  Juan Pérez (dueño de estancia)  ↔  Juan Pérez de Ardón (vecino)
      nombre 0.90 · años 1529–1600 y 1541–1541

0.62 similar  José Durán  ↔  José Benito Duran
      nombre 0.90 · años 1774–1831 y 1818–1818

0.62 similar  Félix Fernández  ↔  Don Félix Fernández Carranza
      nombre 0.90 · años 1781–1818 y 1809–1812
```
