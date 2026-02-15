"""
Extended Gloss Rules

Additional rules for complex linguistic transformations.
"""

from typing import List, Dict, Optional
import re


class GlossRules:
    """
    Advanced gloss transformation rules.
    
    Handles:
    - Aspect marking (habitual, continuative, inceptive)
    - Number incorporation
    - Verb agreement
    - Classifier constructions
    """
    
    # Aspect markers that modify verbs
    ASPECT_MARKERS = {
        'always': 'habitual',
        'usually': 'habitual',
        'keep': 'continuative',
        'continuously': 'continuative',
        'start': 'inceptive',
        'begin': 'inceptive',
        'finish': 'completive',
        'stop': 'cessative',
    }
    
    # Numbers that can be incorporated into signs
    NUMBER_INCORPORATION = {
        'one', 'two', 'three', 'four', 'five',
        'week', 'day', 'hour', 'minute', 'month', 'year',
        'dollar', 'time'
    }
    
    # Verbs that show agreement (directional verbs)
    DIRECTIONAL_VERBS = {
        'GIVE', 'TAKE', 'SHOW', 'TELL', 'ASK', 'HELP',
        'GO-TO', 'COME', 'VISIT', 'CALL'
    }
    
    @staticmethod
    def apply_aspect(gloss: str, aspect: str) -> str:
        """
        Apply aspect marker to verb gloss.
        
        In Auslan, aspect is often shown by:
        - Reduplication (repeating the sign)
        - Modified movement
        - Specific facial expressions
        """
        aspect_suffix = {
            'habitual': '+rep',      # Repeated movement
            'continuative': '+cont', # Held with tremor
            'inceptive': '+start',   # Sharp onset
            'completive': '+finish', # Sharp ending
            'cessative': '+stop',    # Abrupt stop
        }
        
        suffix = aspect_suffix.get(aspect, '')
        return f"{gloss}{suffix}" if suffix else gloss
    
    @staticmethod
    def incorporate_number(number: str, noun: str) -> Optional[str]:
        """
        Check if number can be incorporated into noun.
        
        Example: "two weeks" → "TWO-WEEKS" (single sign)
        """
        if noun.lower() in GlossRules.NUMBER_INCORPORATION:
            number_gloss = number.upper()
            noun_gloss = noun.upper()
            return f"{number_gloss}-{noun_gloss}"
        return None
    
    @staticmethod
    def apply_directional_verb(verb: str, subject_idx: int, object_idx: int) -> str:
        """
        Mark verb with subject-object agreement.
        
        Directional verbs move from subject location to object location.
        
        Args:
            verb: Base verb gloss
            subject_idx: Spatial index of subject (1=signer, 2=addressee, 3+=other)
            object_idx: Spatial index of object
            
        Returns:
            Annotated verb gloss
        """
        if verb.upper() in GlossRules.DIRECTIONAL_VERBS:
            return f"{verb}-({subject_idx}->{object_idx})"
        return verb
    
    @staticmethod
    def detect_classifier_construction(words: List[str]) -> Optional[Dict]:
        """
        Detect if sentence describes something that uses classifiers.
        
        Classifiers in Auslan:
        - Entity classifiers (person, vehicle, animal)
        - Handling classifiers (how you hold something)
        - Size-and-shape specifiers (SASS)
        
        Returns:
            Classifier info or None
        """
        # Entity classifiers
        entity_patterns = {
            r'\b(person|people|man|woman|walk)\b': 'CL:person',
            r'\b(car|bus|drive|vehicle)\b': 'CL:vehicle',
            r'\b(animal|dog|cat|run)\b': 'CL:animal',
        }
        
        for pattern, classifier in entity_patterns.items():
            if any(re.search(pattern, w, re.I) for w in words):
                return {
                    'type': 'entity',
                    'classifier': classifier,
                    'requires_location': True
                }
        
        return None
    
    @staticmethod
    def handle_negation(gloss_sequence: List[str]) -> List[str]:
        """
        Apply negation rules.
        
        Auslan negation strategies:
        1. Headshake with positive sign
        2. NOT + sign
        3. Sign + ZERO (none)
        """
        # If NOT is present, keep it with headshake marker
        if 'NOT' in gloss_sequence:
            return [g if g != 'NOT' else 'NOT[headshake]' for g in gloss_sequence]
        
        return gloss_sequence
    
    @staticmethod
    def handle_conditionals(clause_type: str, glosses: List[str]) -> List[str]:
        """
        Handle conditional (if-then) constructions.
        
        Auslan: Raised eyebrows on condition, head nod on result.
        """
        if clause_type == 'condition':
            # Mark with raised brows
            return [f"{g}[raised-brows]" for g in glosses]
        elif clause_type == 'result':
            # Mark with head nod
            return [f"{g}[head-nod]" for g in glosses]
        
        return glosses
    
    @staticmethod
    def handle_relative_clauses(glosses: List[str], head_noun: str) -> List[str]:
        """
        Handle relative clause constructions.
        
        Auslan: Head tilt back, squinted eyes on relative clause
        """
        # Mark entire clause
        return [f"{g}[relative]" for g in glosses]


class FingerspellingRules:
    """
    Rules for when to fingerspell vs use established signs.
    """
    
    # Always fingerspell
    ALWAYS_SPELL = {
        'proper_names': True,
        'brand_names': True,
    }
    
    # Sometimes fingerspell for emphasis/clarity
    SOMETIMES_SPELL = {
        'technical_terms': True,
        'loan_words': True,
    }
    
    @staticmethod
    def should_fingerspell(word: str, context: Dict) -> bool:
        """
        Determine if a word should be fingerspelled.
        
        Args:
            word: The word to check
            context: Dict with keys like 'is_name', 'is_technical', etc.
            
        Returns:
            True if should fingerspell
        """
        # Proper names (capitalized in English)
        if word[0].isupper() and context.get('is_name', True):
            return True
        
        # Known exceptions
        common_words = {'i', 'a', 'the', 'and', 'or', 'but'}
        if word.lower() in common_words:
            return False
        
        # If no sign exists in database
        if context.get('sign_not_found', False):
            return True
        
        # Technical terms
        if context.get('is_technical', False):
            return True
        
        return False
    
    @staticmethod
    def optimize_fingerspelling(letters: List[str]) -> List[str]:
        """
        Apply fingerspelling optimizations.
        
        - Lexicalized signs (e.g., #JOB, #BANK from fingerspelling)
        - Common abbreviations
        """
        lexicalized = {
            'job': '#JOB',
            'bank': '#BANK',
            'work': '#WORK',
        }
        
        word = ''.join(letters).lower()
        if word in lexicalized:
            return [lexicalized[word]]
        
        return letters
