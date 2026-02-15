"""
Auslan Grammar Rules

Auslan (Australian Sign Language) has distinct grammar from English:
- Topic-comment structure (not subject-verb-object)
- Time markers at start of sentence
- Question words at end
- Spatial indexing for pronouns
- No articles (a, an, the)
- Aspectual marking on verbs
"""

import re
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from enum import Enum


class SignType(Enum):
    NOUN = "noun"
    VERB = "verb"
    ADJECTIVE = "adjective"
    ADVERB = "adverb"
    PRONOUN = "pronoun"
    TIME = "time"
    QUESTION = "question"
    CLASSIFIER = "classifier"
    FINGER_SPELL = "fingerspell"
    POINTING = "pointing"


@dataclass
class GlossToken:
    """A token in Auslan gloss notation."""
    gloss: str                    # The gloss (uppercase typically)
    sign_type: SignType
    english_source: str           # Original English word(s)
    spatial_index: Optional[int] = None  # For pronoun referencing
    modifiers: List[str] = None   # Aspect, intensity, etc.
    
    def __post_init__(self):
        if self.modifiers is None:
            self.modifiers = []


class AuslanGrammar:
    """
    Implements Auslan grammatical transformations.
    
    Reference: Johnston & Schembri (2007) "Australian Sign Language"
    """
    
    # Time words that should move to sentence start
    TIME_WORDS = {
        'yesterday', 'today', 'tomorrow', 'now', 'later', 'before',
        'after', 'morning', 'afternoon', 'evening', 'night',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
        'saturday', 'sunday', 'week', 'month', 'year',
        'last_week', 'next_week', 'last_year', 'next_year'
    }
    
    # Question signs that move to end
    QUESTION_WORDS = {
        'what', 'where', 'when', 'who', 'why', 'how', 'which',
        'how_many', 'how_much'
    }
    
    # Words that get dropped (no direct sign, use non-manual features)
    DROPPED_WORDS = {
        'a', 'an', 'the',  # Articles
        'is', 'are', 'was', 'were', 'be', 'been', 'being',  # Copula (often)
        'do', 'does', 'did',  # Auxiliary (often)
        'to',  # Infinitive marker (often dropped)
    }
    
    # Common word → gloss mappings
    GLOSS_MAP = {
        # Time
        'yesterday': 'YESTERDAY',
        'today': 'NOW/TODAY',
        'tomorrow': 'TOMORROW',
        'now': 'NOW',
        
        # Pronouns (spatial indexing applied later)
        'i': 'IX-1',      # Index to self
        'me': 'IX-1',
        'my': 'POSS-1',   # Possessive
        'you': 'IX-2',    # Index to addressee
        'your': 'POSS-2',
        'he': 'IX-3a',    # Index to established point
        'she': 'IX-3a',
        'him': 'IX-3a',
        'her': 'IX-3a',
        'it': 'IX-3i',    # Inanimate
        'we': 'IX-1+2',   # 1+2 = inclusive we
        'us': 'IX-1+2',
        'they': 'IX-3pl', # Plural
        'them': 'IX-3pl',
        
        # Common verbs (basic forms, aspect added later)
        'go': 'GO-TO',
        'went': 'GO-TO',
        'come': 'COME',
        'came': 'COME',
        'want': 'WANT',
        'wanted': 'WANT',
        'like': 'LIKE',
        'liked': 'LIKE',
        'have': 'HAVE',
        'had': 'HAVE',
        'eat': 'EAT',
        'ate': 'EAT',
        'drink': 'DRINK',
        'drank': 'DRINK',
        'see': 'SEE',
        'saw': 'SEE',
        'know': 'KNOW',
        'knew': 'KNOW',
        'think': 'THINK',
        'thought': 'THINK',
        'say': 'SAY',
        'said': 'SAY',
        'tell': 'TELL',
        'told': 'TELL',
        'ask': 'ASK',
        'asked': 'ASK',
        'give': 'GIVE',
        'gave': 'GIVE',
        'take': 'TAKE',
        'took': 'TAKE',
        'make': 'MAKE',
        'made': 'MAKE',
        'get': 'GET',
        'got': 'GET',
        
        # Questions
        'what': 'WHAT',
        'where': 'WHERE',
        'when': 'WHEN',
        'who': 'WHO',
        'why': 'WHY',
        'how': 'HOW',
        
        # Negation (co-occurring with headshake)
        'not': 'NOT',
        'no': 'NO',
        "don't": 'NOT',
        "won't": 'NOT+FUTURE',
        "can't": 'NOT+CAN',
        
        # Auxiliaries with signs
        'can': 'CAN',
        'could': 'CAN',
        'will': 'FUTURE',
        'would': 'FUTURE',
        'should': 'SHOULD',
        'must': 'MUST',
        
        # Common nouns
        'store': 'SHOP',
        'shop': 'SHOP',
        'home': 'HOME',
        'house': 'HOME',
        'school': 'SCHOOL',
        'work': 'WORK',
        'friend': 'FRIEND',
        'family': 'FAMILY',
        'mother': 'MOTHER',
        'mom': 'MOTHER',
        'mum': 'MOTHER',
        'father': 'FATHER',
        'dad': 'FATHER',
        'brother': 'BROTHER',
        'sister': 'SISTER',
        'child': 'CHILD',
        'baby': 'BABY',
        'man': 'MAN',
        'woman': 'WOMAN',
        'person': 'PERSON',
        'people': 'PEOPLE',
        
        # Food
        'food': 'FOOD',
        'water': 'WATER',
        'coffee': 'COFFEE',
        'tea': 'TEA',
        'milk': 'MILK',
        'bread': 'BREAD',
        'meat': 'MEAT',
        'fruit': 'FRUIT',
        'vegetable': 'VEGETABLE',
        
        # Feelings
        'happy': 'HAPPY',
        'sad': 'SAD',
        'angry': 'ANGRY',
        'tired': 'TIRED',
        'sick': 'SICK',
        'hot': 'HOT',
        'cold': 'COLD',
        'good': 'GOOD',
        'bad': 'BAD',
        
        # Descriptors
        'big': 'BIG',
        'small': 'SMALL',
        'many': 'MANY',
        'much': 'MANY',
        'some': 'SOME',
        'all': 'ALL',
        'none': 'NONE',
        'more': 'MORE',
        'less': 'LESS',
    }
    
    def __init__(self):
        self.spatial_indices = {}  # Track established referents
        self.next_spatial_index = 3  # 1 = signer, 2 = addressee, 3+ = others
    
    def english_to_gloss(self, words: List[str], pos_tags: List[Tuple[str, str]]) -> List[GlossToken]:
        """
        Convert English words to Auslan gloss sequence.
        
        Args:
            words: List of lowercase English words
            pos_tags: List of (word, pos_tag) tuples
            
        Returns:
            List of GlossTokens in Auslan order
        """
        tokens = []
        
        # Step 1: Convert to glosses
        for word, pos in pos_tags:
            token = self._word_to_gloss(word, pos)
            if token:  # Skip dropped words
                tokens.append(token)
        
        # Step 2: Apply Auslan word order (topic-comment)
        tokens = self._reorder_topic_comment(tokens)
        
        # Step 3: Handle spatial indexing for pronouns
        tokens = self._apply_spatial_indexing(tokens)
        
        return tokens
    
    def _word_to_gloss(self, word: str, pos: str) -> Optional[GlossToken]:
        """Convert a single English word to gloss."""
        word = word.lower().strip('.,!?;:"')
        
        # Skip dropped words
        if word in self.DROPPED_WORDS:
            return None
        
        # Look up gloss
        gloss = self.GLOSS_MAP.get(word, word.upper())
        
        # Determine sign type from POS tag
        sign_type = self._pos_to_sign_type(pos, word)
        
        return GlossToken(
            gloss=gloss,
            sign_type=sign_type,
            english_source=word
        )
    
    def _pos_to_sign_type(self, pos: str, word: str) -> SignType:
        """Map POS tag to sign type."""
        if word.lower() in self.TIME_WORDS:
            return SignType.TIME
        if word.lower() in self.QUESTION_WORDS:
            return SignType.QUESTION
        
        pos_map = {
            'NN': SignType.NOUN,
            'NNS': SignType.NOUN,
            'NNP': SignType.NOUN,
            'VB': SignType.VERB,
            'VBD': SignType.VERB,
            'VBG': SignType.VERB,
            'VBN': SignType.VERB,
            'VBP': SignType.VERB,
            'VBZ': SignType.VERB,
            'JJ': SignType.ADJECTIVE,
            'JJR': SignType.ADJECTIVE,
            'JJS': SignType.ADJECTIVE,
            'RB': SignType.ADVERB,
            'RBR': SignType.ADVERB,
            'RBS': SignType.ADVERB,
            'PRP': SignType.PRONOUN,
            'PRP$': SignType.PRONOUN,
        }
        
        return pos_map.get(pos, SignType.NOUN)
    
    def _reorder_topic_comment(self, tokens: List[GlossToken]) -> List[GlossToken]:
        """
        Reorder tokens to Auslan topic-comment structure.
        
        Auslan order typically:
        1. Time markers
        2. Topic (what we're talking about)
        3. Location/context
        4. Comment (what about it)
        5. Question words (if any)
        """
        time_markers = [t for t in tokens if t.sign_type == SignType.TIME]
        question_words = [t for t in tokens if t.sign_type == SignType.QUESTION]
        other_tokens = [t for t in tokens if t.sign_type not in 
                       (SignType.TIME, SignType.QUESTION)]
        
        # Find topic (usually first noun phrase or object)
        # For simplicity: first noun is topic
        topic = []
        comment = []
        found_topic = False
        
        for token in other_tokens:
            if not found_topic and token.sign_type == SignType.NOUN:
                topic.append(token)
                found_topic = True
            else:
                comment.append(token)
        
        # If no clear topic, just use all as comment
        if not topic:
            comment = other_tokens
        
        # Assemble: Time + Topic + Comment + Question
        result = time_markers + topic + comment + question_words
        
        return result
    
    def _apply_spatial_indexing(self, tokens: List[GlossToken]) -> List[GlossToken]:
        """
        Apply spatial indexing for pronouns.
        
        In Auslan, once a referent is established in space,
        it's referenced by pointing to that location.
        """
        # Reset spatial tracking
        self.spatial_indices = {}
        self.next_spatial_index = 3
        
        result = []
        
        for token in tokens:
            if token.sign_type == SignType.NOUN:
                # Assign spatial index to nouns (for later pronoun reference)
                if token.gloss not in self.spatial_indices:
                    self.spatial_indices[token.gloss] = self.next_spatial_index
                    token.spatial_index = self.next_spatial_index
                    self.next_spatial_index += 1
                    if self.next_spatial_index > 5:  # Max 3 external referents
                        self.next_spatial_index = 3
            
            elif token.sign_type == SignType.PRONOUN:
                # Update pronoun to point to established referent
                if '3' in token.gloss:  # Third person
                    # Find most recent noun to reference
                    if self.spatial_indices:
                        ref = list(self.spatial_indices.values())[-1]
                        token.spatial_index = ref
                        token.gloss = f'IX-{ref}'
            
            result.append(token)
        
        return result
    
    def add_non_manual_features(self, tokens: List[GlossToken]) -> Dict:
        """
        Add non-manual features (facial expressions, head movements).
        
        Returns metadata for avatar animation.
        """
        features = {
            'eyebrows': 'neutral',
            'head_tilt': 0,
            'headshake': False,
            'eye_gaze': 'forward',
            'mouth': 'neutral'
        }
        
        # Questions: eyebrows up for yes/no, furrowed for wh-
        if any(t.sign_type == SignType.QUESTION for t in tokens):
            question = [t for t in tokens if t.sign_type == SignType.QUESTION][0]
            if question.gloss in ['WHAT', 'WHERE', 'WHEN', 'WHO', 'WHY', 'HOW']:
                features['eyebrows'] = 'furrowed'  # Wh-questions
            else:
                features['eyebrows'] = 'raised'    # Yes/no questions
            features['head_tilt'] = 'forward'
        
        # Negation: headshake
        if any(t.gloss == 'NOT' for t in tokens):
            features['headshake'] = True
        
        # Emotions from adjectives
        emotion_map = {
            'HAPPY': {'eyebrows': 'raised', 'mouth': 'smile'},
            'SAD': {'eyebrows': 'furrowed', 'mouth': 'frown'},
            'ANGRY': {'eyebrows': 'furrowed', 'mouth': 'tight'},
        }
        
        for token in tokens:
            if token.gloss in emotion_map:
                features.update(emotion_map[token.gloss])
        
        return features
