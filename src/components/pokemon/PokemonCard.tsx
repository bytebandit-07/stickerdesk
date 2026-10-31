import React, { useRef, useState, useCallback } from 'react';
import type { PokemonCardData } from '../../types/pokemon';
import '../../styles/pokemon/pokemon.css';

interface PokemonCardProps {
  card: PokemonCardData;
  scale?: number;
  onPinToDesktop?: (card: PokemonCardData) => void;
  interactive?: boolean;
}

export const PokemonCard: React.FC<PokemonCardProps> = ({
  card,
  scale = 1,
  onPinToDesktop,
  interactive = true,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isInteracting, setIsInteracting] = useState<boolean>(false);
  const [imgLoaded, setImgLoaded] = useState<boolean>(false);

  // Cosmos and holographic procedural seeds matching pokemon-cards-css
  const seedsRef = useRef({
    seedx: Math.random(),
    seedy: Math.random(),
    cosmosX: Math.floor(Math.random() * 734),
    cosmosY: Math.floor(Math.random() * 1280),
  });

  const [styleVars, setStyleVars] = useState<React.CSSProperties>({
    ['--pointer-x' as string]: '50%',
    ['--pointer-y' as string]: '50%',
    ['--pointer-from-center' as string]: 0,
    ['--pointer-from-top' as string]: 0.5,
    ['--pointer-from-left' as string]: 0.5,
    ['--card-opacity' as string]: 0,
    ['--rotate-x' as string]: '0deg',
    ['--rotate-y' as string]: '0deg',
    ['--background-x' as string]: '50%',
    ['--background-y' as string]: '50%',
    ['--card-scale' as string]: scale,
    ['--seedx' as string]: seedsRef.current.seedx,
    ['--seedy' as string]: seedsRef.current.seedy,
    ['--cosmosbg' as string]: `${seedsRef.current.cosmosX}px ${seedsRef.current.cosmosY}px`,
  });

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const el = cardRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const clientX = e.clientX;
      const clientY = e.clientY;

      const px = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const py = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));

      const dx = (px - 50) / 50;
      const dy = (py - 50) / 50;
      const centerDist = Math.min(1, Math.sqrt(dx * dx + dy * dy));

      const maxRot = 16;
      const rotX = -dy * maxRot;
      const rotY = dx * maxRot;

      setStyleVars((prev) => ({
        ...prev,
        ['--pointer-x' as string]: `${px.toFixed(2)}%`,
        ['--pointer-y' as string]: `${py.toFixed(2)}%`,
        ['--pointer-from-center' as string]: centerDist.toFixed(3),
        ['--pointer-from-top' as string]: (py / 100).toFixed(3),
        ['--pointer-from-left' as string]: (px / 100).toFixed(3),
        ['--card-opacity' as string]: 1,
        ['--rotate-x' as string]: `${rotX.toFixed(2)}deg`,
        ['--rotate-y' as string]: `${rotY.toFixed(2)}deg`,
        ['--background-x' as string]: `${px.toFixed(2)}%`,
        ['--background-y' as string]: `${py.toFixed(2)}%`,
        ['--card-scale' as string]: scale,
      }));
      setIsInteracting(true);
    },
    [interactive, scale]
  );

  const handlePointerLeave = useCallback(() => {
    setIsInteracting(false);
    setStyleVars((prev) => ({
      ...prev,
      ['--pointer-x' as string]: '50%',
      ['--pointer-y' as string]: '50%',
      ['--pointer-from-center' as string]: 0,
      ['--pointer-from-top' as string]: 0.5,
      ['--pointer-from-left' as string]: 0.5,
      ['--card-opacity' as string]: 0,
      ['--rotate-x' as string]: '0deg',
      ['--rotate-y' as string]: '0deg',
      ['--background-x' as string]: '50%',
      ['--background-y' as string]: '50%',
      ['--card-scale' as string]: scale,
    }));
  }, [scale]);

  const typeClass = (card.types || []).join(' ').toLowerCase();
  const subtypesAttr = (card.subtypes || []).join(' ').toLowerCase();
  const supertypeAttr = (card.supertype || 'pokemon').toLowerCase();
  const rarityAttr = (card.rarity || 'common').toLowerCase();
  const isTrainerGallery = Boolean(
    card.number.match(/^[tg]g/i) || card.id === 'swshp-SWSH076' || card.id === 'swshp-SWSH077'
  );

  const cardClasses = [
    'card',
    'interactive',
    typeClass,
    isInteracting ? 'active interacting' : '',
    imgLoaded ? '' : 'loading',
  ]
    .filter(Boolean)
    .join(' ');

  const cardImgSrc = card.images.small || card.images.large || `/img/pokemon/cards/${card.id}.png`;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      <div
        ref={cardRef}
        className={cardClasses}
        data-number={card.number}
        data-set={card.set}
        data-subtypes={subtypesAttr}
        data-supertype={supertypeAttr}
        data-rarity={rarityAttr}
        data-trainer-gallery={isTrainerGallery}
        style={{
          ...styleVars,
          cursor: 'pointer',
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <div className="card__translater">
          <div className="card__rotator">
            <img
              className="card__back"
              src="/img/pokemon/card-back.jpg"
              alt="Card Back"
              loading="lazy"
              width="660"
              height="921"
            />
            <div className="card__front">
              <img
                src={cardImgSrc}
                alt={card.name}
                loading="lazy"
                width="660"
                height="921"
                onLoad={() => setImgLoaded(true)}
              />
              <div className="card__shine" />
              <div className="card__glare" />
            </div>
          </div>
        </div>
      </div>

      {onPinToDesktop && (
        <button
          type="button"
          onClick={() => onPinToDesktop(card)}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: '#4f46e5',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4338ca')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f46e5')}
        >
          📌 Pin to Desktop
        </button>
      )}
    </div>
  );
};
